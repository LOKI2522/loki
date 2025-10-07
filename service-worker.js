// Define a name for our cache
const CACHE_NAME = 'archiva-cache-v1';

// List of files to cache when the service worker is installed
const urlsToCache = [
  '/',
  '/LandingPage.html',
  '/Login.html',
  '/uploads/1st.jpg',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// Install event: Cache the core files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event: Serve cached files first, or fetch from network
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        // Not in cache - fetch from network
        return fetch(event.request);
      })
  );
});

// Push event: Handle incoming push notifications
self.addEventListener('push', event => {
  const data = event.data.json();
  console.log('New notification received', data);

  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png'
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});