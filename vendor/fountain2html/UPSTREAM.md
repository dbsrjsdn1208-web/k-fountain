# Upstream source

Repository: https://github.com/wixette/fountain2html

Revision: f7a741d06a3de6602efe04f4673daa315e3bc9da

Author: wixette. License: Apache-2.0 (see LICENSE).

The src/ and themes/ directories are verbatim upstream snapshots, including its tests. Production uses the derived copies in ../../src/engine/ and the unmodified theme CSS. Changes to those derived files are marked in their headers: source mapping, safe HTML, optional Korean scene prefixes and numbering, title metadata, lyrics, escaped emphasis, whitespace and forced-action corrections. Korean opt-ins are implemented outside the parser in ../../src/screenplay.js.

The upstream tests remain unchanged. Additional tests exercise the actual production engine and compare ordinary upstream cases against the unmodified parser and renderer. This is open source under license, not public-domain code.

Preview editing extends the derived parser's token ranges to include Fountain syntax and records inline emphasis delimiter spans in the renderer. The editor applies source-range edits, preserves hidden comments, shares source undo history, and supports raw-paragraph and formatted-document modes. Original vendor sources and theme files remain unchanged.

The former raw-paragraph textarea mode is now an inline Live Preview. A source-mapped projection reveals syntax and notes touched by the cursor/selection while retaining screenplay and emphasis styling. Selection-only updates patch affected blocks without creating source/history changes. The stored `source` mode value remains compatible; the formatted-document mode is retained.

Preview navigation now retains original UTF-16 spans through parser captures and inline rendering instead of finding token text in the source. Each rendered element has a unique token ID and visible-character source map. Navigation uses glyph hit testing, conservative stale-edit rebasing, and a textarea-style measurement mirror; original vendor snapshots are unchanged.

K-파운틴 v2 also adapts the upstream index.html black/blue header, native textarea and 32/68 split. Korean scene-prefix conversion is now used only when importing legacy documents; the active editor uses standard Fountain syntax. Additional fork fixes preserve one-character scene headings, display manual scene IDs, and calculate source block offsets in one pass. Optional scene renumbering and registered-name completion live outside the parser.
