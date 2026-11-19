export class Player {
  constructor(
    public readonly id: string,
    public name: string,
    public score: number = 0,
    public isHost: boolean = false,
    // Compte connecté (null = invité) : sert à l'historique, jamais envoyé aux autres joueurs.
    public userId: number | null = null,
    public username: string | null = null
  ) {}
}
