/** Whether `text` has no half of a surrogate pair (String.prototype.isWellFormed is newer than the library the project compiles against). */
export const isWellFormed = (text: string): boolean => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
