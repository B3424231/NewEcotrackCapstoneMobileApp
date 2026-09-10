import { Vibration } from 'react-native';

type NotificationListener = (title: string, body: string, isAlert: boolean) => void;
const listeners = new Set<NotificationListener>();

export const NotificationEmitter = {
  addListener(listener: NotificationListener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  trigger(title: string, body: string, isAlert: boolean) {
    // Try to trigger a nice tactile vibration feedback
    try {
      Vibration.vibrate([0, 150, 100, 150]);
    } catch (e) {
      console.log('Vibration not supported or failed:', e);
    }
    
    // Notify all active listeners to render the overlay banner
    listeners.forEach((listener) => {
      try {
        listener(title, body, isAlert);
      } catch (err) {
        console.error('Error invoking notification listener:', err);
      }
    });
  }
};
