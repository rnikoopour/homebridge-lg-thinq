/** Refresh this many seconds before LG's stated expiry, so a request never races it. */
export const TOKEN_EXPIRY_MARGIN_SECONDS = 60;

export class Session {
  private expiresOn = 0;

  constructor(
    private _accessToken: string,
    private readonly _refreshToken: string,
    private expiresIn: number,
  ) {
    this.newToken(_accessToken, expiresIn);
  }

  public newToken(accessToken, expiresIn): void {
    this._accessToken = accessToken;
    this.expiresIn = Number(expiresIn) || 0;
    this.expiresOn = Session.getCurrentEpoch() + this.expiresIn;
  }

  public get accessToken(): string {
    return this._accessToken;
  }

  public get refreshToken(): string {
    return this._refreshToken;
  }

  public hasToken(): boolean {
    return !!this._accessToken;
  }

  public isTokenExpired(): boolean {
    return this.expiresOn - TOKEN_EXPIRY_MARGIN_SECONDS <= Session.getCurrentEpoch();
  }

  public hasValidToken(): boolean {
    return this.hasToken() && !this.isTokenExpired();
  }

  private static getCurrentEpoch(): number {
    return Math.round(new Date().getTime() / 1000);
  }
}
