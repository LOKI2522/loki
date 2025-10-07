const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const multer = require('multer');
const webpush = require('web-push'); // PWA LIBRARY ADDED

// --- 2. Create Express App ---
const app = express();
const port = 3001;

// --- 3. Middleware Setup ---
app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static('public'));
app.use(express.static(__dirname)); // ADDED FOR PWA FILES (serves manifest.json, etc.)

// --- 4. MySQL Database Connection Pool ---
// --- 4. MySQL Database Connection Pool ---
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'campus_connect',
    multipleStatements: true,
    connectionLimit: 10,
    dateStrings: true // <-- INTHA LINE AH ADD PANNUNGA
});

const promiseDb = db.promise();
console.log(`\n\n[DATABASE] Connecting to -> [HOST: ${db.config.connectionConfig.host}, USER: ${db.config.connectionConfig.user}, DATABASE: ${db.config.connectionConfig.database}]\n`);

// --- 5. Multer setup for file storage ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });


// =================================================================
// === PUSH NOTIFICATION SETUP (NEW CODE BLOCK) ====================
// =================================================================
const publicVapidKey = 'BK0U-RF8ccWm2WfcYD-Rlpl2I9FKEt_Tr1haOh63ZbA8dB5XX8Z3Yn5ZgUN4vP4oiVywUGoCMk_lrWiygXiQQHM'; // Replace with your key
const privateVapidKey = '6l7NXjvOaWpEHACExBxLvSAuK8gz-vTACR6pAWP7JOY'; // Replace with your key

webpush.setVapidDetails('mailto:your-email@example.com', publicVapidKey, privateVapidKey);

app.post('/api/save-subscription', async (req, res) => {
    const subscription = req.body;
    try {
        const sql = "INSERT INTO push_subscriptions (subscription) VALUES (?) ON DUPLICATE KEY UPDATE subscription = VALUES(subscription)";
        await promiseDb.query(sql, [JSON.stringify(subscription)]);
        res.status(201).json({ success: true, message: 'Subscription saved.' });
    } catch (error) {
        console.error("Error saving subscription:", error);
        res.status(500).json({ success: false, message: 'Could not save subscription.' });
    }
});

app.post('/api/send-notification', async (req, res) => {
    const notificationPayload = {
        title: 'New Update from ARCHIVA!',
        body: 'Check the portal for a new announcement.',
        icon: '/icons/icon-192x192.png'
    };

    try {
        const [subscriptions] = await promiseDb.query("SELECT subscription FROM push_subscriptions");
        const promises = subscriptions.map(s => webpush.sendNotification(JSON.parse(s.subscription), JSON.stringify(notificationPayload)));
        await Promise.all(promises);
        res.status(200).json({ success: true, message: 'Notifications sent.' });
    } catch (error) {
        console.error("Error sending notifications:", error);
        res.status(500).json({ success: false, message: 'Could not send notifications.' });
    }
});


// =================================================================
// === AUTHENTICATION & PROFILE APIs ===============================
// =================================================================
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }
    try {
        const sql = `SELECT u.id as user_id, u.name, u.email, u.password, u.role, s.id as staff_id, s.profile_picture_url, s.department FROM users u LEFT JOIN staff s ON u.email = s.email WHERE u.email = ?`;
        const [users] = await promiseDb.query(sql, [email]);
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials. User not found.' });
        }
        const user = users[0];
        const isPasswordMatch = await bcrypt.compare(password, user.password);
        if (!isPasswordMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials. Incorrect password.' });
        }
        res.status(200).json({
            success: true,
            message: 'Login successful!',
            user: { id: user.user_id, name: user.name, email: user.email, role: user.role, department: user.department, profile_picture_url: user.profile_picture_url }
        });
    } catch (err) {
        console.error("❌ CRITICAL LOGIN ERROR:", err);
        res.status(500).json({ success: false, message: 'An internal server error occurred.' });
    }
});

app.get('/api/profile', async (req, res) => {
    const { email } = req.query;
    if (!email) {
        return res.status(400).json({ success: false, message: 'Email query parameter is required.' });
    }
    try {
        const sql = `SELECT s.*, u.name, u.role FROM staff s JOIN users u ON s.user_id = u.id WHERE s.email = ?`;
        const [staffRows] = await promiseDb.query(sql, [email]);
        
        if (staffRows.length > 0) {
            return res.status(200).json(staffRows[0]);
        } else {
            const [userRows] = await promiseDb.query("SELECT id as user_id, name, email, role FROM users WHERE email = ?", [email]);
            if (userRows.length > 0) {
                return res.status(200).json(userRows[0]);
            } else {
                 return res.status(404).json({ success: false, message: 'Profile not found.' });
            }
        }
    } catch (err) {
        console.error(`❌ CRITICAL PROFILE FETCH ERROR for ${email}:`, err);
        res.status(500).json({ success: false, message: 'An internal server error occurred.' });
    }
});

// =================================================================
// === PROFILE UPDATE APIs =========================================
// =================================================================
app.post('/api/profile/picture', upload.single('profile_picture'), async (req, res) => {
    const { email } = req.body;
    if (!req.file || !email) {
        return res.status(400).json({ success: false, message: 'File and email are required.' });
    }
    const filePath = `/uploads/${req.file.filename}`;
    try {
        const sql = "UPDATE staff SET profile_picture_url = ? WHERE email = ?";
        const [result] = await promiseDb.query(sql, [filePath, email]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        res.json({ success: true, message: 'Profile picture updated successfully!', filePath: filePath });
    } catch (err) {
        console.error(`❌ PROFILE PICTURE UPDATE FAILED for ${email}:`, err);
        res.status(500).json({ success: false, message: 'Database error while updating profile picture.' });
    }
});
app.patch('/api/profile/password', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and new password are required.' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = "UPDATE users SET password = ? WHERE email = ?";
        const [result] = await promiseDb.query(sql, [hashedPassword, email]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        res.json({ success: true, message: 'Password updated successfully!' });
    } catch (err) {
        console.error(`❌ PASSWORD UPDATE FAILED for ${email}:`, err);
        res.status(500).json({ success: false, message: 'Database error while updating password.' });
    }
});

// =================================================================
// === HOD & STAFF DASHBOARD APIs ==================================
// =================================================================

app.get('/api/staff/timetables/today', async (req, res) => {
    try {
        const { email } = req.query;
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required.' });
        }
        
        const todayDate = new Date().toISOString().slice(0, 10);
        const [calendarRows] = await promiseDb.query('SELECT is_working_day FROM academic_calendar WHERE calendar_date = ?', [todayDate]);
        if (calendarRows.length > 0 && calendarRows[0].is_working_day == 0) {
            return res.json({ success: true, todayTimetable: [] });
        }
        
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const today = days[new Date().getDay()];

        if (today === 'Sunday') {
             return res.json({ success: true, todayTimetable: [] });
        }

        const sql = `
            SELECT 
                *, 
                CASE
                    WHEN CURTIME() > end_time THEN 'Completed'
                    WHEN CURTIME() >= start_time AND CURTIME() <= end_time THEN 'Ongoing'
                    ELSE 'Upcoming'
                END AS status
            FROM timetables 
            WHERE 
                staff_email = ? AND 
                LOWER(TRIM(day_of_week)) = LOWER(?) 
            ORDER BY start_time
        `;
        const [rows] = await promiseDb.query(sql, [email, today]);
        res.json({ success: true, todayTimetable: rows });
    } catch (err) {
        console.error("--- ERROR fetching today's timetable ---", err);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch timetable. Check the server terminal for error details.'
        });
    }
});


app.get('/api/staff/department/:department', async (req, res) => {
    const { department } = req.params;
    try {
        const sql = `SELECT s.id, u.name, s.email, s.profile_picture_url FROM staff s JOIN users u ON s.user_id = u.id WHERE s.department = ? ORDER BY u.name`;
        const [staffList] = await promiseDb.query(sql, [department]);
        res.json(staffList);
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch staff list.' });
    }
});
app.get('/api/staff/details/:staffId', async (req, res) => {
    const { staffId } = req.params;
    try {
        const sql = `SELECT s.*, u.name, u.role FROM staff s JOIN users u ON s.user_id = u.id WHERE s.id = ?`;
        const [staffRows] = await promiseDb.query(sql, [staffId]);
        res.json(staffRows[0]);
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch staff details.' });
    }
});
app.get('/api/staff/timetables/:staffId', async (req, res) => {
    const { staffId } = req.params;
    try {
        const [staffRows] = await promiseDb.query("SELECT email FROM staff WHERE id = ?", [staffId]);
        if (staffRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Staff member not found.' });
        }
        const staffEmail = staffRows[0].email;
        const sql = "SELECT * FROM timetables WHERE staff_email = ? ORDER BY FIELD(day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'), start_time";
        const [timetableRows] = await promiseDb.query(sql, [staffEmail]);
        res.json(timetableRows);
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch timetable.' });
    }
});
app.get('/api/hod/classes/:department', async (req, res) => {
    const { department } = req.params;
    try {
        const sql = `SELECT DISTINCT year, section FROM timetables WHERE department = ? AND year IN ('1', '2', '3', '4') ORDER BY year, section`;
        const [classes] = await promiseDb.query(sql, [department]);
        res.json({ success: true, classes });
    } catch (error) {
        console.error("Error fetching HOD classes:", error);
        res.status(500).json({ success: false, message: 'Failed to fetch classes.' });
    }
});
app.get('/api/staff/my-classes/:email', async (req, res) => {
    const { email } = req.params;
    try {
        const sql = `SELECT DISTINCT year, section, department FROM timetables WHERE staff_email = ? ORDER BY year, section`;
        const [classes] = await promiseDb.query(sql, [email]);
        res.json({ success: true, classes });
    } catch (error) {
        console.error("Error fetching staff's own classes:", error);
        res.status(500).json({ success: false, message: 'Failed to fetch assigned classes.' });
    }
});

app.get('/api/hod/attendance/:department/:year/:section', async (req, res) => {
    const { department, year, section } = req.params;
    try {
        const yearOfStudyMap = { '1': '1st Year', '2': '2nd Year', '3': '3rd Year', '4': '4th Year' };
        const yearOfStudy = yearOfStudyMap[year] || `${year}th Year`;

        const [students] = await promiseDb.query("SELECT student_name, register_number FROM students WHERE department = ? AND year_of_study = ? AND section = ?", [department, yearOfStudy, section]);
        if (students.length === 0) {
            return res.json({ success: true, students: [], attendance: [] });
        }
        const studentRegNos = students.map(s => s.register_number);

        const [attendanceRecords] = await promiseDb.query(`
            SELECT a.student_reg_no, a.attendance_date, a.period_number, a.status, a.reason, a.created_at, u.name as staff_name 
            FROM attendance a 
            JOIN staff s ON a.staff_id = s.id
            JOIN users u ON s.user_id = u.id 
            WHERE a.student_reg_no IN (?) AND a.attendance_date >= CURDATE() - INTERVAL 3 DAY 
            ORDER BY a.attendance_date DESC, a.period_number`, 
            [studentRegNos]
        );
        
        res.json({ success: true, students, attendance: attendanceRecords });
    } catch (error) {
        console.error("ERROR fetching HOD attendance:", error);
        res.status(500).json({ success: false, message: 'Failed to fetch attendance data.' });
    }
});

// =================================================================
// === MARK AND ATTENDANCE APIs ====================================
// =================================================================
app.get('/api/students/:department/:year/:section', async (req, res) => {
    const { department, year, section } = req.params;
    try {
        const yearOfStudyMap = { '1': '1st Year', '2': '2nd Year', '3': '3rd Year', '4': '4th Year' };
        const yearOfStudy = yearOfStudyMap[year] || `${year}th Year`;

        const sql = `SELECT student_name, register_number FROM students WHERE department = ? AND year_of_study = ? AND section = ? ORDER BY RIGHT(register_number, 3)`;
        const [students] = await promiseDb.query(sql, [department, yearOfStudy, section]);
        res.json({ success: true, students });
    } catch (error) {
        console.error("Error fetching students:", error);
        res.status(500).json({ success: false, message: 'Failed to fetch student list.' });
    }
});

app.get('/api/marks/:department/:year/:section', async (req, res) => {
    const { department, year, section } = req.params;
    try {
        const yearOfStudyMap = { '1': '1st Year', '2': '2nd Year', '3': '3rd Year', '4': '4th Year' };
        const yearOfStudy = yearOfStudyMap[year] || `${year}th Year`;
        
        const sql = `SELECT s.student_name, s.register_number, m.* FROM students s LEFT JOIN internal_marks m ON s.register_number = m.student_reg_no WHERE s.department = ? AND s.year_of_study = ? AND s.section = ? ORDER BY RIGHT(s.register_number, 3)`;
        const [students] = await promiseDb.query(sql, [department, yearOfStudy, section]);
        res.json({ success: true, students });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch marks.' });
    }
});
app.post('/api/marks/save', async (req, res) => {
    const { marksData, year, section, department } = req.body;
    const connection = await promiseDb.getConnection();
    try {
        await connection.beginTransaction();
        for (const student of marksData) {
            const sql = `INSERT INTO internal_marks (student_reg_no, year, section, department, cat1_marks, cat2_marks, sac1_marks, sac2_marks, sac3_marks, sac4_marks, sac5_marks, internal_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE cat1_marks = VALUES(cat1_marks), cat2_marks = VALUES(cat2_marks), sac1_marks = VALUES(sac1_marks), sac2_marks = VALUES(sac2_marks), sac3_marks = VALUES(sac3_marks), sac4_marks = VALUES(sac4_marks), sac5_marks = VALUES(sac5_marks), internal_total = VALUES(internal_total)`;
            await connection.query(sql, [student.reg_no, year, section, department, student.cat1_marks, student.cat2_marks, student.sac1_marks, student.sac2_marks, student.sac3_marks, student.sac4_marks, student.sac5_marks, student.internal_total]);
        }
        await connection.commit();
        res.json({ success: true, message: 'Marks saved successfully!' });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ success: false, message: 'Database error while saving marks.' });
    } finally {
        connection.release();
    }
});
app.post('/api/attendance/save', async (req, res) => {
    const { attendanceData } = req.body;
    if (!attendanceData || attendanceData.length === 0) {
        return res.status(400).json({ success: false, message: 'Attendance data is empty.' });
    }
    const connection = await promiseDb.getConnection();
    try {
        await connection.beginTransaction();
        const sql = `
            INSERT INTO attendance (student_reg_no, staff_id, attendance_date, period_number, status, reason) 
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE status = VALUES(status), reason = VALUES(reason)
        `;
        for (const record of attendanceData) {
            await connection.query(sql, [
                record.student_reg_no,
                record.staff_id,
                record.attendance_date,
                record.period_number,
                record.status,
                record.reason
            ]);
        }
        await connection.commit();
        res.json({ success: true, message: 'Attendance saved successfully!' });
    } catch (error) {
        await connection.rollback();
        console.error("Error saving attendance:", error);
        res.status(500).json({ success: false, message: 'Database error while saving attendance.' });
    } finally {
        connection.release();
    }
});
app.get('/api/hod/attendance/by-date-range/:department/:year/:section', async (req, res) => {
    const { department, year, section } = req.params;
    const { fromDate, toDate } = req.query;
    try {
        const yearOfStudyMap = { '1': '1st Year', '2': '2nd Year', '3': '3rd Year', '4': '4th Year' };
        const yearOfStudy = yearOfStudyMap[year] || `${year}th Year`;
        
        const [students] = await promiseDb.query("SELECT student_name, register_number FROM students WHERE department = ? AND year_of_study = ? AND section = ?", [department, yearOfStudy, section]);
        if (students.length === 0) {
            return res.json({ success: true, report: [] });
        }
        const studentRegNos = students.map(s => s.register_number);
        const [attendanceRecords] = await promiseDb.query(`SELECT student_reg_no, status FROM attendance WHERE student_reg_no IN (?) AND attendance_date BETWEEN ? AND ?`, [studentRegNos, fromDate, toDate]);
        
        const [holidays] = await promiseDb.query('SELECT calendar_date, activity_description FROM academic_calendar WHERE calendar_date BETWEEN ? AND ? AND is_working_day = 0', [fromDate, toDate]);

        const report = students.map(student => {
            const records = attendanceRecords.filter(r => r.student_reg_no === student.register_number);
            const present_count = records.filter(r => r.status === 'Present').length;
            const absent_count = records.filter(r => r.status === 'Absent').length;
            const onduty_count = records.filter(r => r.status === 'On Duty').length;
            const total_periods = present_count + absent_count;
            const percentage = total_periods > 0 ? ((present_count / total_periods) * 100).toFixed(2) : '0.00';
            return { ...student, present_count, absent_count, onduty_count, attendance_percentage: percentage };
        });
        res.json({ success: true, report, holidays });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch attendance report.' });
    }
});

// =================================================================
// === LESSON PLAN & FILE UPLOAD APIs ============================
// =================================================================
app.get('/api/staff/my-courses/:email', async (req, res) => {
    const { email } = req.params;
    try {
        const sql = `SELECT DISTINCT class_name, course_code FROM timetables WHERE staff_email = ? ORDER BY class_name`;
        const [courses] = await promiseDb.query(sql, [email]);
        res.json({ success: true, courses });
    } catch (error) {
        console.error("Error fetching staff's courses:", error);
        res.status(500).json({ success: false, message: 'Failed to fetch assigned courses.' });
    }
});
const lessonPlanUpload = multer({ storage: storage }).array('lesson_plans', 10);
app.post('/api/lesson-plans/upload', (req, res) => {
    lessonPlanUpload(req, res, async (err) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'File upload error.', error: err });
        }
        const { staff_id, course_code } = req.body;
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'No files selected.' });
        }
        const connection = await promiseDb.getConnection();
        try {
            await connection.beginTransaction();
            const sql = "INSERT INTO lesson_plans (staff_id, course_code, file_name, file_path) VALUES (?, ?, ?, ?)";
            for (const file of req.files) {
                const filePath = `/uploads/${file.filename}`;
                await connection.query(sql, [staff_id, course_code, file.originalname, filePath]);
            }
            await connection.commit();
            res.json({ success: true, message: 'Files uploaded successfully!' });
        } catch (error) {
            await connection.rollback();
            console.error("Database error during file upload:", error);
            res.status(500).json({ success: false, message: 'Database error.' });
        } finally {
            connection.release();
        }
    });
});
app.get('/api/lesson-plans/:course_code', async (req, res) => {
    const { course_code } = req.params;
    const { staff_id } = req.query;
    try {
        const sql = "SELECT * FROM lesson_plans WHERE staff_id = ? AND course_code = ? ORDER BY uploaded_at DESC";
        const [files] = await promiseDb.query(sql, [staff_id, course_code]);
        res.json({ success: true, files });
    } catch (error) {
        console.error("Error fetching files:", error);
        res.status(500).json({ success: false, message: 'Failed to fetch files.' });
    }
});
app.delete('/api/lesson-plans/delete/:file_id', async (req, res) => {
    const { file_id } = req.params;
    try {
        const [result] = await promiseDb.query("DELETE FROM lesson_plans WHERE id = ?", [file_id]);
        if (result.affectedRows === 0) {
             return res.status(404).json({ success: false, message: 'File not found.' });
        }
        res.json({ success: true, message: 'File deleted successfully.' });
    } catch (error) {
        console.error("Error deleting file:", error);
        res.status(500).json({ success: false, message: 'Failed to delete file.' });
    }
});

// ================================================================= 
// === ADMIN APIs ==================================================
// ================================================================= 
app.get('/api/admin/staff-list', async (req, res) => {
    try {
        const sql = `SELECT s.id, u.name, u.email FROM users u JOIN staff s ON u.id = s.user_id ORDER BY u.name`;
        const [rows] = await promiseDb.query(sql);
        res.json({ success: true, staffList: rows });
    } catch (err) {
        console.error("Error fetching staff list:", err);
        res.status(500).json({ success: false, message: 'Failed to fetch staff list.' });
    }
});
app.get('/api/admin/timetables/:staff_email', async (req, res) => {
    try {
        const { staff_email } = req.params;
        const sql = "SELECT * FROM timetables WHERE staff_email = ? ORDER BY FIELD(day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'), start_time";
        const [rows] = await promiseDb.query(sql, [staff_email]);
        res.json({ success: true, timetable: rows });
    } catch (err) {
        console.error("Error fetching timetable:", err);
        res.status(500).json({ success: false, message: 'Failed to fetch timetable.' });
    }
});
app.post('/api/admin/timetables', async (req, res) => {
    try {
        const { staff_email, class_name, course_code, department, year, section, semester, day_of_week, start_time, end_time, period_number } = req.body;
        const sql = "INSERT INTO timetables (staff_email, class_name, course_code, department, year, section, semester, day_of_week, start_time, end_time, period_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        await promiseDb.query(sql, [staff_email, class_name, course_code, department, year, section, semester, day_of_week, start_time, end_time, period_number]);
        res.json({ success: true, message: 'Timetable entry added successfully!' });
    } catch (err) {
        console.error("Error adding timetable entry:", err);
        res.status(500).json({ success: false, message: 'Failed to add timetable entry.' });
    }
});
app.put('/api/admin/timetables/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { staff_email, class_name, course_code, department, year, section, semester, day_of_week, start_time, end_time, period_number } = req.body;
        const sql = "UPDATE timetables SET staff_email=?, class_name=?, course_code=?, department=?, year=?, section=?, semester=?, day_of_week=?, start_time=?, end_time=?, period_number=? WHERE id=?";
        const values = [staff_email, class_name, course_code, department, year, section, semester, day_of_week, start_time, end_time, period_number, id];
        const [result] = await promiseDb.query(sql, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Timetable entry not found or no new data provided to update.' });
        }
        res.json({ success: true, message: 'Timetable entry updated successfully!' });
    } catch (err) {
        console.error("Error updating timetable entry:", err);
        res.status(500).json({ success: false, message: 'Failed to update timetable entry.' });
    }
});
app.delete('/api/admin/timetables/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await promiseDb.query("DELETE FROM timetables WHERE id = ?", [id]);
        res.json({ success: true, message: 'Timetable entry deleted successfully.' });
    } catch (err) {
        console.error("Error deleting timetable entry:", err);
        res.status(500).json({ success: false, message: 'Failed to delete timetable entry.' });
    }
});
app.get('/api/admin/students', async (req, res) => {
    try {
        const [rows] = await promiseDb.query("SELECT * FROM students ORDER BY RIGHT(register_number, 3)");
        res.json({ success: true, students: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch students.' });
    }
});

app.get('/api/admin/students/:year/:section', async (req, res) => {
    const { year, section } = req.params;
    const yearOfStudyMap = { '1': '1st Year', '2': '2nd Year', '3': '3rd Year', '4': '4th Year' };
    const yearOfStudy = yearOfStudyMap[year] || `${year}th Year`;
    
    try {
        const [rows] = await promiseDb.query(
            "SELECT * FROM students WHERE year_of_study = ? AND section = ? ORDER BY RIGHT(register_number, 3)", 
            [yearOfStudy, section]
        );
        res.json({ success: true, students: rows });
    } catch (err) {
        console.error("Error fetching students by class:", err);
        res.status(500).json({ success: false, message: 'Failed to fetch students.' });
    }
});

app.get('/api/admin/students/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await promiseDb.query("SELECT * FROM students WHERE id = ?", [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        res.json({ success: true, student: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch student details.' });
    }
});
app.post('/api/admin/students', async (req, res) => {
    const { studentData } = req.body;
    const sql = `INSERT INTO students (student_name, register_number, roll_number, year_of_study, department, section, semester, from_year, to_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [studentData.student_name, studentData.register_number, studentData.roll_number, studentData.year_of_study, studentData.department, studentData.section, studentData.semester, studentData.from_year, studentData.to_year];
    try {
        await promiseDb.query(sql, values);
        res.json({ success: true, message: 'Student added successfully!' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'Register Number or Roll Number already exists.' });
        }
        return res.status(500).json({ success: false, message: 'Failed to add student.' });
    }
});
app.put('/api/admin/students/:id', async (req, res) => {
    const { id } = req.params;
    const { studentData } = req.body;
    const sql = `UPDATE students SET student_name = ?, register_number = ?, roll_number = ?, year_of_study = ?, department = ?, section = ?, semester = ?, from_year = ?, to_year = ? WHERE id = ?`;
    const values = [studentData.student_name, studentData.register_number, studentData.roll_number, studentData.year_of_study, studentData.department, studentData.section, studentData.semester, studentData.from_year, studentData.to_year, id];
    try {
        const [result] = await promiseDb.query(sql, values);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Student not found or no new data to update.' });
        }
        res.json({ success: true, message: 'Student details updated successfully!' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'Register Number or Roll Number already exists.' });
        }
        return res.status(500).json({ success: false, message: 'Failed to update student.' });
    }
});
app.delete('/api/admin/students/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await promiseDb.query("DELETE FROM students WHERE id = ?", [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Student not found.' });
        }
        res.json({ success: true, message: 'Student deleted successfully.' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to delete student.' });
    }
});
app.get('/api/admin/staff', async (req, res) => {
    try {
        const sql = `SELECT s.*, u.email, u.role FROM staff s LEFT JOIN users u ON s.user_id = u.id ORDER BY s.first_name`;
        const [rows] = await promiseDb.query(sql);
        res.json({ success: true, staff: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch staff.' });
    }
});
app.get('/api/admin/staff/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const sql = `SELECT s.*, u.email, u.role FROM staff s LEFT JOIN users u ON s.user_id = u.id WHERE s.id = ?`;
        const [rows] = await promiseDb.query(sql, [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Staff not found.' });
        }
        res.json({ success: true, staff: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch staff details.' });
    }
});
app.post('/api/admin/staff', async (req, res) => {
    const { staffData } = req.body;
    let connection;
    try {
        connection = await promiseDb.getConnection();
        await connection.beginTransaction();
        const hashedPassword = await bcrypt.hash(staffData.password, 10);
        const userName = `${staffData.first_name} ${staffData.last_name || ''}`.trim();
        const [userResult] = await connection.query(`INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`, [userName, staffData.email, hashedPassword, staffData.role]);
        const newUserId = userResult.insertId;
        const staffSql = `INSERT INTO staff (user_id, prefix, first_name, last_name, gender, date_of_birth, blood_group, mobile_number, marital_status, alternative_mobile_number, alternative_email, aadhaar_number, religion, mother_tongue, nationality, state, profile_status, department, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const staffValues = [newUserId, staffData.prefix, staffData.first_name, staffData.last_name, staffData.gender, staffData.date_of_birth, staffData.blood_group, staffData.mobile_number, staffData.marital_status, staffData.alternative_mobile_number, staffData.alternative_email, staffData.aadhaar_number, staffData.religion, staffData.mother_tongue, staffData.nationality, staffData.state, staffData.profile_status, staffData.department, staffData.email];
        await connection.query(staffSql, staffValues);
        await connection.commit();
        res.json({ success: true, message: 'Staff member created successfully!' });
    } catch (err) {
        if (connection) await connection.rollback();
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'This Email already exists.' });
        }
        res.status(500).json({ success: false, message: 'Failed to create staff member.' });
    } finally {
        if (connection) connection.release();
    }
});
app.put('/api/admin/staff/:id', async (req, res) => {
    const { id } = req.params;
    const { staffData } = req.body;
    let connection;
    try {
        connection = await promiseDb.getConnection();
        await connection.beginTransaction();
        const [staffRows] = await connection.query('SELECT user_id FROM staff WHERE id = ?', [id]);
        if (staffRows.length === 0) throw new Error('Staff not found');
        const userId = staffRows[0].user_id;
        const staffSql = `UPDATE staff SET prefix=?, first_name=?, last_name=?, gender=?, date_of_birth=?, blood_group=?, mobile_number=?, marital_status=?, alternative_mobile_number=?, alternative_email=?, aadhaar_number=?, religion=?, mother_tongue=?, nationality=?, state=?, profile_status=?, department=?, email=? WHERE id=?`;
        const staffValues = [staffData.prefix, staffData.first_name, staffData.last_name, staffData.gender, staffData.date_of_birth, staffData.blood_group, staffData.mobile_number, staffData.marital_status, staffData.alternative_mobile_number, staffData.alternative_email, staffData.aadhaar_number, staffData.religion, staffData.mother_tongue, staffData.nationality, staffData.state, staffData.profile_status, staffData.department, staffData.email, id];
        const [staffResult] = await connection.query(staffSql, staffValues);

        const userName = `${staffData.first_name} ${staffData.last_name || ''}`.trim();
        let userSql = 'UPDATE users SET name=?, email=?, role=?';
        const userValues = [userName, staffData.email, staffData.role];
        if (staffData.password) {
            const hashedPassword = await bcrypt.hash(staffData.password, 10);
            userSql += ', password=?';
            userValues.push(hashedPassword);
        }
        userSql += ' WHERE id=?';
        userValues.push(userId);
        const [userResult] = await connection.query(userSql, userValues);

        if (staffResult.affectedRows === 0 && userResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'No new data provided to update.' });
        }

        await connection.commit();
        res.json({ success: true, message: 'Staff member updated successfully!' });
    } catch (err) {
        if (connection) await connection.rollback();
        if (err.message === 'Staff not found') {
            return res.status(404).json({ success: false, message: 'Staff not found.' });
        }
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'This Email already exists for another user.' });
        }
        res.status(500).json({ success: false, message: 'Failed to update staff member.' });
    } finally {
        if (connection) connection.release();
    }
});
app.delete('/api/admin/staff/:id', async (req, res) => {
    const { id } = req.params;
    let connection;
    try {
        connection = await promiseDb.getConnection();
        await connection.beginTransaction();
        const [staffRows] = await connection.query('SELECT user_id FROM staff WHERE id = ?', [id]);
        if (staffRows.length === 0) throw new Error('Staff not found');
        const userIdToDelete = staffRows[0].user_id;
        await connection.query('DELETE FROM staff WHERE id = ?', [id]);
        await connection.query('DELETE FROM users WHERE id = ?', [userIdToDelete]);
        await connection.commit();
        res.json({ success: true, message: 'Staff member deleted successfully.' });
    } catch (err) {
        if (connection) await connection.rollback();
        if (err.message === 'Staff not found') return res.status(404).json({ success: false, message: 'Staff member not found.' });
        res.status(500).json({ success: false, message: 'Failed to delete staff member.' });
    } finally {
        if (connection) connection.release();
    }
});

// ===================================================================
// === ACADEMIC CALENDAR API ROUTES (ADDED AND CORRECTED) ============
// ===================================================================

// ADMIN: Bulk import calendar data
app.post('/api/admin/calendar/bulk-import', async (req, res) => {
    const entries = req.body;
    if (!Array.isArray(entries)) {
        return res.status(400).json({ success: false, message: 'Invalid data format. Array is expected.' });
    }

    let connection;
    try {
        connection = await promiseDb.getConnection();
        await connection.beginTransaction();
        const query = `
            INSERT INTO academic_calendar (calendar_date, is_working_day, activity_description)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
                is_working_day = VALUES(is_working_day),
                activity_description = VALUES(activity_description)`;
        
        console.log(`[BULK IMPORT] Starting to process ${entries.length} entries.`);
        for (const entry of entries) {
            if (entry.date && typeof entry.is_working_day !== 'undefined' && entry.activity) {
                await connection.query(query, [entry.date, entry.is_working_day, entry.activity]);
            }
        }
        
        await connection.commit();
        console.log(`[BULK IMPORT] Successfully committed entries.`);
        res.json({ success: true, message: 'Calendar imported successfully.' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('❌ ERROR DURING BULK CALENDAR IMPORT:', err);
        res.status(500).json({ success: false, message: 'Failed to import calendar data. Check server terminal for logs.' });
    } finally {
        if (connection) connection.release();
    }
});

// ADMIN: Update a single calendar entry
app.post('/api/admin/calendar/update', async (req, res) => {
    const { calendar_date, is_working_day, activity_description } = req.body;
    if (!calendar_date) {
        return res.status(400).json({ success: false, message: 'Date is required.' });
    }
    try {
        const query = `
            INSERT INTO academic_calendar (calendar_date, is_working_day, activity_description)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
                is_working_day = VALUES(is_working_day),
                activity_description = VALUES(activity_description)
        `;
        await promiseDb.query(query, [calendar_date, is_working_day, activity_description]);
        res.json({ success: true, message: 'Calendar entry updated successfully.' });
    } catch (err) {
        console.error('Error updating calendar entry:', err);
        res.status(500).json({ success: false, message: 'Failed to update entry.' });
    }
});

// PUBLIC: Get calendar data for a specific month (CORRECTED ROUTE NAME)
app.get('/api/admin/calendar', async (req, res) => {
    const { year, month } = req.query;
    if (!year || !month) {
        return res.status(400).json({ success: false, message: 'Year and month are required.' });
    }
    try {
        const [rows] = await promiseDb.query(
            'SELECT * FROM academic_calendar WHERE YEAR(calendar_date) = ? AND MONTH(calendar_date) = ?',
            [year, month]
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('Error fetching calendar data:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch calendar data.' });
    }
});

// PUBLIC: Get details for a single date
app.get('/api/calendar/date/:date', async (req, res) => {
    const { date } = req.params;
    try {
        const [rows] = await promiseDb.query('SELECT * FROM academic_calendar WHERE calendar_date = ?', [date]);
        if (rows.length > 0) {
            res.json({ success: true, data: rows[0] });
        } else {
            res.json({ success: true, data: { calendar_date: date, is_working_day: 1, activity_description: '' } });
        }
    } catch (err) {
        console.error('Error fetching single date info:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch date information.' });
    }
});


// --- Start Server --- 
app.listen(port, () => {
    console.log(`✅ Campus Connect backend server is running on http://localhost:${port}`);
});
