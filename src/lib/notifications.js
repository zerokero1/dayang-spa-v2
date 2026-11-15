const EVENT_NAME = 'dayang:notification';

export function notify(message, type = 'success') {
  if (!message || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, {
    detail: { message: String(message), type }
  }));
}

export function notifySuccess(message) {
  notify(message, 'success');
}

export function notifyError(message) {
  notify(message, 'error');
}

export function notificationEventName() {
  return EVENT_NAME;
}
