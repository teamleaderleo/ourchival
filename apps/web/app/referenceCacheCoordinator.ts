export type ReferenceCacheRequestToken = {
  generation: number;
  key: string;
};

export class ReferenceCacheCoordinator {
  private generation = 0;
  private activeKey = "";
  private networkSettledGeneration = 0;

  begin(key: string): ReferenceCacheRequestToken {
    this.generation += 1;
    this.activeKey = key;
    return { generation: this.generation, key };
  }

  canApplyCache(token: ReferenceCacheRequestToken) {
    return (
      token.generation === this.generation &&
      token.key === this.activeKey &&
      this.networkSettledGeneration < token.generation
    );
  }

  markNetworkSettled(token: ReferenceCacheRequestToken) {
    if (token.generation !== this.generation || token.key !== this.activeKey) {
      return false;
    }
    this.networkSettledGeneration = token.generation;
    return true;
  }

  isCurrent(token: ReferenceCacheRequestToken) {
    return token.generation === this.generation && token.key === this.activeKey;
  }
}
