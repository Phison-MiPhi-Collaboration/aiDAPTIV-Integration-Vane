// The ONLY place a group's prompt text is formatted. The rendered block is
// saved at upload time and sent byte-for-byte at the start of the researcher
// and writer system prompts, so the server can reuse the KV cache warmed for
// it. Changing this format invalidates every warmed group.

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export const renderGroupBlock = (input: {
  fileName: string;
  part: number;
  of: number;
  text: string;
}) =>
  `<document_group file="${escapeAttribute(input.fileName)}" part="${input.part}" of="${input.of}">\n${input.text.trim()}\n</document_group>\n`;
