// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { importMusicXml, decodeMusicXml } from "../src/files/musicxml";
import { beats, midiPitch } from "../src/core/model";
import { value } from "../src/core/rational";
import { validateScore } from "../src/core/validation";
const attributes =
  "<attributes><divisions>12</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>";
const note = (pitch = "C", extra = "", span = 12, type = "quarter") =>
  `<note>${extra}<pitch><step>${pitch}</step><octave>4</octave></pitch><duration>${span}</duration><voice>1</voice><type>${type}</type></note>`;
const xml = (body: string) =>
  `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Import study</work-title></work><identification><creator type="composer">Composer</creator></identification><part-list><score-part id="P1"><part-name>Piano</part-name><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
describe("MusicXML import", () => {
  it("imports title, composer, exact pitch, and meter", () => {
    const { score, warnings } = importMusicXml(
      xml(`<measure number="1">${attributes}${note()}</measure>`),
    );
    expect(score.title).toBe("Import study");
    expect(score.composer).toBe("Composer");
    expect(score.notes[0].pitches[0].step).toBe("C");
    expect(score.measures[0].beats).toBe(4);
    expect(warnings).toEqual([]);
    validateScore(score);
  });
  it("imports backups, layers, multiple staves and bass clefs", () => {
    const body = `<measure>${attributes.replace("</attributes>", '<staves>2</staves><clef number="2"><sign>F</sign><line>4</line></clef></attributes>')}${note("C")}${note("D")}<backup><duration>24</duration></backup>${note("E").replace("<voice>1</voice>", "<voice>2</voice>")}<backup><duration>12</duration></backup>${note("F").replace("</note>", "<staff>2</staff></note>")}</measure>`;
    const { score } = importMusicXml(xml(body));
    expect(score.staves).toHaveLength(2);
    expect(score.staves[1].clef).toBe("bass");
    expect(score.notes.map((n) => n.voice)).toEqual([0, 0, 1, 0]);
    expect(score.notes.map((n) => value(n.offset))).toEqual([0, 1, 0, 0]);
    validateScore(score);
  });
  it("groups chord notes without advancing time twice", () => {
    const { score } = importMusicXml(
      xml(
        `<measure>${attributes}${note()}${note("E", "<chord/>")}${note("G")}</measure>`,
      ),
    );
    expect(score.notes).toHaveLength(2);
    expect(score.notes[0].pitches).toHaveLength(2);
    expect(value(score.notes[1].offset)).toBe(1);
  });
  it("preserves triplets and dots without quantizing", () => {
    const triplet = note(
      "C",
      "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>",
      4,
      "eighth",
    );
    const { score } = importMusicXml(
      xml(
        `<measure>${attributes}${triplet}${triplet}${triplet}${note("E", "<dot/>", 18)}</measure>`,
      ),
    );
    expect(beats(score.notes[0].duration)).toEqual({ n: 1, d: 3 });
    expect(score.notes[3].offset).toEqual({ n: 1, d: 1 });
    expect(score.notes[3].duration.dots).toBe(1);
    validateScore(score);
  });
  it("connects ties and slurs across measures", () => {
    const { score } = importMusicXml(
      xml(
        `<measure>${attributes}${note("C", '<tie type="start"/><notations><slur type="start" number="1"/></notations>', 48, "whole")}</measure><measure>${note("C", '<tie type="stop"/><notations><slur type="stop" number="1"/></notations>')}</measure>`,
      ),
    );
    expect(score.notes[0].tieTo).toBe(score.notes[1].id);
    expect(score.notes[0].slurTo).toBe(score.notes[1].id);
    validateScore(score);
  });
  it("imports dynamics, tempo, hairpins, repeat barlines and endings", () => {
    const { score } = importMusicXml(
      xml(
        `<measure>${attributes}<direction><direction-type><dynamics><pp/></dynamics><wedge type="crescendo"/></direction-type><sound tempo="72"/></direction>${note()}<direction><direction-type><wedge type="stop"/></direction-type></direction><barline><repeat direction="forward"/><ending type="start" number="1"/></barline></measure>`,
      ),
    );
    expect(score.tempo).toBe(72);
    expect(score.marks.map((m) => m.kind)).toEqual(["dynamic", "hairpin"]);
    expect(score.marks[1].endOffset).toEqual({ n: 1, d: 1 });
    expect(score.measures[0]).toMatchObject({ repeatStart: true, ending: 1 });
    validateScore(score);
  });
  it("honors a pickup bar and exact following bar offsets", () => {
    const { score } = importMusicXml(
      xml(
        `<measure implicit="yes">${attributes}${note()}</measure><measure>${note()}</measure>`,
      ),
    );
    expect(score.measures[0].pickup).toEqual({ n: 1, d: 1 });
    validateScore(score);
  });
  it("reads grace notes and common articulations", () => {
    const { score } = importMusicXml(
      xml(
        `<measure>${attributes}<note><grace/><pitch><step>D</step><octave>4</octave></pitch><voice>1</voice></note>${note("C", "<notations><articulations><staccato/></articulations></notations>")}</measure>`,
      ),
    );
    expect(score.notes[0].grace?.[0].step).toBe("D");
    expect(score.notes[0].articulation).toBe("staccato");
  });
  it("imports sounding transposition and one-based MIDI programs", () => {
    const text = xml(
      `<measure>${attributes.replace("</attributes>", "<transpose><chromatic>-2</chromatic></transpose></attributes>")}${note()}</measure>`,
    ).replace(
      "<midi-program>1</midi-program>",
      "<midi-program>72</midi-program>",
    );
    const { score } = importMusicXml(text);
    expect(score.instruments[0]).toMatchObject({ program: 71, transpose: -2 });
  });
  it("maps unpitched percussion using midi-unpitched", () => {
    const text = xml(
      `<measure>${attributes}<note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>12</duration><type>quarter</type><instrument id="I1"/></note></measure>`,
    ).replace(
      "</midi-instrument>",
      "<midi-unpitched>39</midi-unpitched></midi-instrument>",
    );
    const { score, warnings } = importMusicXml(text);
    expect(midiPitch(score.notes[0].pitches[0])).toBe(38);
    expect(score.instruments[0].percussion).toBe(true);
    expect(warnings[0]).toMatch(/percussion/);
  });
  it("decodes compressed MusicXML from the declared root path", () => {
    const source = xml(`<measure>${attributes}${note()}</measure>`);
    const zip = zipSync({
      "META-INF/container.xml": strToU8(
        '<container><rootfiles><rootfile full-path="scores/piece.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>',
      ),
      "scores/piece.musicxml": strToU8(source),
    });
    expect(decodeMusicXml(zip)).toBe(source);
    expect(importMusicXml(decodeMusicXml(zip)).score.notes).toHaveLength(1);
  });
  it("rejects broken or unsupported files with useful errors", () => {
    expect(() => importMusicXml("<broken>")).toThrow(/well-formed/);
    expect(() => importMusicXml("<score-timewise/>")).toThrow(/score-partwise/);
    expect(() =>
      importMusicXml('<!DOCTYPE a [<!ENTITY x "boom">]><a/>'),
    ).toThrow(/entity/);
    expect(() =>
      decodeMusicXml(zipSync({ "other.xml": strToU8("<x/>") })),
    ).toThrow(/container/);
  });
  it("rejects overfull bars rather than discarding notes", () => {
    expect(() =>
      importMusicXml(
        xml(
          `<measure>${attributes}${note("C", "", 48, "whole")}${note()}</measure>`,
        ),
      ),
    ).toThrow(/more beats/);
  });
  it("rejects more than four voices instead of dropping voices", () => {
    const body = Array.from(
      { length: 5 },
      (_, i) =>
        `${i ? "<backup><duration>12</duration></backup>" : ""}${note().replace("<voice>1</voice>", `<voice>${i + 1}</voice>`)}`,
    ).join("");
    expect(() =>
      importMusicXml(xml(`<measure>${attributes}${body}</measure>`)),
    ).toThrow(/four voices/);
  });
  it("reports unsupported lyrics and chord symbols instead of silently losing them", () => {
    const { warnings } = importMusicXml(
      xml(
        `<measure>${attributes}${note("C", "<lyric><text>Hello</text></lyric>")}<harmony/></measure>`,
      ),
    );
    expect(warnings).toHaveLength(2);
  });
});
