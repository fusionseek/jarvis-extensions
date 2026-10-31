/**
 * 解析器读不出时抛的错（纯数据，不带给用户的话）：给用户的那句话由 `engine.ts` 按是哪个工具、哪一种失败来写。
 */

/** `malformed` = 输出不是那个工具的 JSON；`unrecognized` = 工具跑通了，但认不出这个文件的格式。 */
export type MediaReadFailureKind = "malformed" | "unrecognized";

/** 解析器读不出。 */
export class MediaReadFailure extends Error {
  /**
   * @param kind 哪一种读不出。
   */
  constructor(readonly kind: MediaReadFailureKind) {
    super(kind);
    this.name = "MediaReadFailure";
  }
}
