const CACHE_NAME = 'pomodoro-v22b';
const ASSETS = ['./index.html', './manifest.json', './icon-192.png', './icon-512.png'];

// ── Install: cache all assets for offline use ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: cache-first for app assets, stale-while-revalidate for fonts & Firebase SDK ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'www.gstatic.com') {
    e.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(e.request).then(cached => {
          const fetching = fetch(e.request).then(response => {
            if (response.ok) cache.put(e.request, response.clone());
            return response;
          }).catch(() => cached);
          return cached || fetching;
        })
      )
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// ── Timer state ──
let alarmTimeout = null;
let checkInterval = null;
let timerState = null;
let alarmActive = false;

// ── Break state ──
let breakTimeout = null;
let breakState = null;

function clearTimers() {
  clearTimeout(alarmTimeout);
  clearInterval(checkInterval);
  alarmTimeout = null;
  checkInterval = null;
}

function clearBreakTimers() {
  clearTimeout(breakTimeout);
  breakTimeout = null;
  breakState = null;
}

// ── Message handling ──
self.addEventListener('message', e => {
  const data = e.data;

  if (data.type === 'START_TIMER') {
    clearTimers();
    alarmActive = false;
    timerState = { task: data.task, duration: data.duration, endTime: data.endTime };
    const ms = data.endTime - Date.now();
    if (ms > 0) {
      alarmTimeout = setTimeout(() => fireAlarm(data.task, data.duration), ms);
      checkInterval = setInterval(() => {
        if (timerState && Date.now() >= timerState.endTime) {
          clearInterval(checkInterval);
          checkInterval = null;
          fireAlarm(timerState.task, timerState.duration);
        }
      }, 5000);
    } else {
      fireAlarm(data.task, data.duration);
    }
  }

  if (data.type === 'CANCEL_TIMER') {
    clearTimers();
    alarmActive = false;
    timerState = null;
    self.registration.getNotifications().then(notifs => notifs.forEach(n => {
      if (n.tag === 'pomodoro-alarm') n.close();
    }));
  }

  if (data.type === 'STOP_ALARM') {
    clearTimers();
    clearInterval(self._alarmRepeat);
    alarmActive = false;
    timerState = null;
    self.registration.getNotifications().then(notifs => notifs.forEach(n => {
      if (n.tag === 'pomodoro-alarm') n.close();
    }));
  }

  if (data.type === 'HEARTBEAT') {
    if (data.endTime && data.isRunning) {
      const remaining = data.endTime - Date.now();
      if (remaining <= 0) {
        fireAlarm(data.task, data.duration);
      } else if (!alarmTimeout) {
        timerState = { task: data.task, duration: data.duration, endTime: data.endTime };
        alarmTimeout = setTimeout(() => fireAlarm(data.task, data.duration), remaining);
        if (!checkInterval) {
          checkInterval = setInterval(() => {
            if (timerState && Date.now() >= timerState.endTime) {
              clearInterval(checkInterval);
              checkInterval = null;
              fireAlarm(timerState.task, timerState.duration);
            }
          }, 5000);
        }
      }
    }
  }

  // ── Break timer support ──
  if (data.type === 'START_BREAK') {
    clearBreakTimers();
    breakState = { duration: data.duration, endTime: data.endTime };
    const ms = data.endTime - Date.now();
    if (ms > 0) {
      breakTimeout = setTimeout(() => fireBreakDone(data.duration), ms);
    }
  }

  if (data.type === 'CANCEL_BREAK') {
    clearBreakTimers();
    self.registration.getNotifications().then(notifs => notifs.forEach(n => {
      if (n.tag === 'pomodoro-break') n.close();
    }));
  }

  if (data.type === 'PING') {
    e.source && e.source.postMessage({ type: 'PONG' });
  }
});

async function fireAlarm(task, duration) {
  clearTimers();
  timerState = null;
  alarmActive = true;

  try {
    await self.registration.showNotification('Pomodoro fertig!', {
      body: task + ' — ' + duration + ' min abgeschlossen',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'pomodoro-alarm',
      renotify: true,
      requireInteraction: true,
      vibrate: [500,200,500,200,500,200,500,200,500,200,500],
      actions: [{ action: 'stop', title: 'Ausschalten' }],
      silent: false,
      urgency: 'high'
    });
  } catch (err) {
    console.error('Notification error:', err);
  }

  self._alarmRepeat = setInterval(async () => {
    try {
      await self.registration.showNotification('🔔 Pomodoro fertig!', {
        body: task + ' — Zeit ist um!',
        icon: './icon-192.png',
        tag: 'pomodoro-alarm',
        renotify: true,
        requireInteraction: true,
        vibrate: [500,200,500,200,500,200,500],
        actions: [{ action: 'stop', title: 'Ausschalten' }],
        silent: false,
        urgency: 'high'
      });
    } catch (err) {}
  }, 8000);

  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => client.postMessage({ type: 'ALARM_FIRED' }));
}

async function fireBreakDone(duration) {
  clearBreakTimers();

  try {
    await self.registration.showNotification('☕ Pause vorbei!', {
      body: duration + ' min Pause beendet — bereit für den nächsten Pomodoro',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'pomodoro-break',
      renotify: true,
      vibrate: [200, 100, 200],
      silent: false
    });
  } catch (err) {
    console.error('Break notification error:', err);
  }

  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => client.postMessage({ type: 'BREAK_DONE' }));
}

self.addEventListener('notificationclick', e => {
  const tag = e.notification.tag;
  e.notification.close();

  if (tag === 'pomodoro-alarm') {
    clearInterval(self._alarmRepeat);
    alarmActive = false;
    timerState = null;

    e.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({ type: 'ALARM_STOPPED' }));
        if (clients.length > 0) {
          clients[0].focus();
        } else {
          self.clients.openWindow('./index.html');
        }
      })
    );
  }

  if (tag === 'pomodoro-break') {
    e.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({ type: 'BREAK_DONE' }));
        if (clients.length > 0) {
          clients[0].focus();
        } else {
          self.clients.openWindow('./index.html');
        }
      })
    );
  }
});

self.addEventListener('notificationclose', e => {
  const tag = e.notification.tag;

  if (tag === 'pomodoro-alarm') {
    if (!alarmActive) return;

    setTimeout(() => {
      if (!alarmActive) return;
      if (!self._alarmRepeat) return;

      clearInterval(self._alarmRepeat);
      self._alarmRepeat = null;
      alarmActive = false;
      timerState = null;

      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({ type: 'ALARM_STOPPED' }));
      });
    }, 500);
  }
});
