export interface Notification {
  title: string;
  body: string;
  /** 'action' = user response wanted (pause, budget); 'info' = progress. */
  priority: 'info' | 'action';
}

export interface Notifier {
  name: string;
  send(n: Notification): Promise<void>;
}
