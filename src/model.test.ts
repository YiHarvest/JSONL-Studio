import { describe, expect, it } from "vitest";
import { parseTree, pointer, pretty } from "./model";
import { renderToStaticMarkup } from "react-dom/server";
import { HighlightText } from "./components/HighlightText";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

describe("lossless visible tree", () => {
  it("retains integer and exponent spellings through Pretty", () => {
    const tree = parseTree(
      '{"id":9007199254740993,"cost":1e-9,"message":"a\\"b","nothing":null}',
    );
    expect(pretty(tree)).toContain("9007199254740993");
    expect(pretty(tree)).toContain("1e-9");
    expect(tree.children?.[2].node.text).toBe('"a\\"b"');
  });
  it("keeps nested arrays, duplicate keys and escaped pointer segments", () => {
    const tree = parseTree('{"a/b~":[[false],{}],"duplicate":1,"duplicate":2}');
    expect(tree.children).toHaveLength(3);
    expect(
      tree.children?.[0].node.children?.[0].node.children?.[0].node.type,
    ).toBe("boolean");
    expect(pointer("", "a/b~")).toBe("/a~1b~0");
  });
  it("guards excessive depth and malformed input", () => {
    expect(() => parseTree("[".repeat(130) + "0" + "]".repeat(130))).toThrow(
      "depth",
    );
    expect(() => parseTree('{"x":')).toThrow();
  });
  it("ships matching English and Chinese message keys", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
  it("highlights every case-insensitive visible match", () => {
    const markup = renderToStaticMarkup(
      HighlightText({ text: "model MODEL remodel", query: "model" }),
    );
    expect(markup.match(/<mark/g)).toHaveLength(3);
    expect(markup).toContain("re<mark");
    expect(markup).toContain(">model</mark>");
  });
});
