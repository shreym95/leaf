import { describe, expect, it } from "vitest";
import { normalizeTitle, titlesMatch } from "./copy-match";

describe("normalizeTitle", () => {
  it.each([
    ["The Time Machine", "time machine"],
    ["  HELLO   World!! ", "hello world"],
    ["Crème brûlée", "creme brulee"],
    ["Frankenstein: Or, The Modern Prometheus", "frankenstein"],
    ["Dune - Part One", "dune"],
    ["A Tale of Two Cities", "tale of two cities"],
    ["An Idiot", "idiot"],
    ["Anna Karenina", "anna karenina"],
    ["Jekyll-Hyde", "jekyll hyde"],
    ["Émile", "emile"],
    ["नमस्ते", "नमस्ते"],
    ["The", "the"],
    ["", ""],
    [null, ""],
    [undefined, ""],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });
});

describe("titlesMatch", () => {
  it("matches equal keys regardless of case, accents, punctuation and article", () => {
    expect(titlesMatch("The Time Machine", "time machine!")).toBe(true);
    expect(titlesMatch("Théâtre", "THEATRE")).toBe(true);
  });

  it("ignores a subtitle after a colon or a spaced dash", () => {
    expect(titlesMatch("Frankenstein", "Frankenstein: A Novel")).toBe(true);
    expect(titlesMatch("Dune - Part One", "Dune")).toBe(true);
  });

  it("does not match a series sibling whose title contains the other", () => {
    expect(titlesMatch("Dune", "Dune Messiah")).toBe(false);
    expect(titlesMatch("Time Machine", "The Time Machine and Other Stories")).toBe(false);
  });

  it("does not match a Devanagari pair that differs only in a vowel sign or virama", () => {
    expect(titlesMatch("नमस्ते", "नमसत")).toBe(false);
  });

  it("matches a title with and without accents", () => {
    expect(titlesMatch("Émile", "Emile")).toBe(true);
  });

  it("matches Greek and Cyrillic titles with and without diacritics", () => {
    expect(titlesMatch("Αντιγόνη", "Αντιγονη")).toBe(true);
    expect(normalizeTitle("Ёжик в тумане")).toBe("ежик в тумане");
    expect(titlesMatch("Ёжик в тумане", "Ежик в тумане")).toBe(true);
  });

  it("ignores a subtitle after the first semicolon", () => {
    expect(normalizeTitle("Frankenstein; Or, The Modern Prometheus")).toBe("frankenstein");
    expect(titlesMatch("Frankenstein", "Frankenstein; Or, The Modern Prometheus")).toBe(true);
  });

  it("never matches an empty title", () => {
    expect(titlesMatch("", "")).toBe(false);
    expect(titlesMatch("", "Dune")).toBe(false);
    expect(titlesMatch(null, "Dune")).toBe(false);
  });

  it("does not match different works", () => {
    expect(titlesMatch("Frankenstein", "Dracula")).toBe(false);
  });
});
