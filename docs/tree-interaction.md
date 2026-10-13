# JSON tree interaction

- One JSONL physical line produces one independent record card.
- The record disclosure folds that card. Node disclosures change only that node.
- Default depth 2 expands the root and first child containers.
- Alt/Option-click applies the same expanded/collapsed state recursively to descendants.
- Toolbar actions expand all, collapse all, or set depths 1/2/3.
- Objects and arrays both initially show up to 50 children; Load 50 more reveals the next batch.
- Each row displays key/index, explicit type, child count and preview or scalar token.
- Copy menu provides key, decoded string value / scalar or container JSON, JSONPath and node JSON.
- Node menus can fill the search field with the key or open the containing record in CodeMirror. Search results expand, reveal and highlight the matching pointer.
- Folding is keyed by physical line and escaped JSON Pointer, scoped to the current session. It is not written into user files or preferences.
- Record header and per-node folding survive virtualization within the current session.
- Tree flattening guards at 10,000 rows. Records above the Raw preview limit use a Rust-backed lazy tree: each request returns at most 50 direct children and 500 bytes per scalar preview, and deeper nodes are fetched only when expanded.
- Scalar strings preview at most 500 characters; copy preserves the full bounded node value.
- Keyboard focus indicators and accessible disclosure labels are included. Full arrow-key tree navigation is a future accessibility enhancement.

Colors follow semantic tokens across themes: keys blue, strings green, numbers amber, booleans violet, null subdued, errors red. Types are always labeled so color is not the sole signal.
