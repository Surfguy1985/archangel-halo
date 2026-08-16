declare module "zodiac-ts" {
  export class HoltSmoothing {
    constructor(data: number[], alpha: number, gamma: number);
    predict(horizon: number): Array<number | null>;
  }
}
