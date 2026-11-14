const clients: Client[] = [];
export const closeAll = () => clients.forEach((c) => c.ws.close());

/** Client socket.io minimal (protocole engine.io v4 sur WebSocket), sans dépendance. */
export class Client {
  id = '';
  private events: [string, any][] = [];
  private waiters: (() => void)[] = [];
  constructor(public ws: WebSocket) {}

  static async connect(url: string): Promise<Client> {
    const client = new Client(new WebSocket(url));
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.ws.onmessage = ({ data }) => {
        const msg = String(data);
        if (msg.startsWith('44')) reject(new Error(JSON.parse(msg.slice(2)).message));
        else if (msg.startsWith('0')) client.ws.send('40');
        else if (msg === '2') client.ws.send('3');
        else if (msg.startsWith('40')) {
          client.id = JSON.parse(msg.slice(2)).sid;
          resolve();
        } else if (msg.startsWith('42')) {
          const [name, payload] = JSON.parse(msg.slice(2));
          client.events.push([name, payload]);
          client.waiters.splice(0).forEach((w) => w());
        }
      };
    });
    return client;
  }

  emit(name: string, payload?: unknown) {
    this.ws.send('42' + JSON.stringify(payload === undefined ? [name] : [name, payload]));
  }

  /** Prochain événement `name` non encore lu ; rejette après `ms`. */
  async next(name: string, ms = 2000): Promise<any> {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = this.events.findIndex(([n]) => n === name);
      if (i >= 0) return this.events.splice(i, 1)[0][1];
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`événement ${name} non reçu`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => (clearTimeout(timer), resolve()));
      });
    }
  }

  count(name: string) {
    return this.events.filter(([n]) => n === name).length;
  }
}
