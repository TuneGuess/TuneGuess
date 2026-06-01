export class Player {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public score: number = 0,
    public isHost: boolean = false
  ) {}
}
