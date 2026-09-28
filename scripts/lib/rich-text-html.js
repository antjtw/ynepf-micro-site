/* ==========================================================================
   rich-text-html.js — render a Contentful Rich Text document to the plain
   HTML markup this site already hand-writes (see faqs.html), with no
   renderer dependency. Covers the node types this site's editors use:
   paragraphs, headings, lists, tables, blockquotes, hr, links, and the
   bold/italic/underline/code marks.
   ========================================================================== */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarks(text, marks = []) {
  return marks.reduce((html, mark) => {
    switch (mark.type) {
      case "bold":
        return `<strong>${html}</strong>`;
      case "italic":
        return `<em>${html}</em>`;
      case "underline":
        return `<u>${html}</u>`;
      case "code":
        return `<code>${html}</code>`;
      default:
        return html;
    }
  }, escapeHtml(text));
}

function renderNodes(nodes) {
  return (nodes || []).map(renderNode).join("");
}

function renderNode(node) {
  switch (node.nodeType) {
    case "document":
      return renderNodes(node.content);
    case "text":
      return renderMarks(node.value, node.marks);
    case "paragraph":
      return `<p>${renderNodes(node.content)}</p>`;
    case "heading-1":
      return `<h1>${renderNodes(node.content)}</h1>`;
    case "heading-2":
      return `<h2>${renderNodes(node.content)}</h2>`;
    case "heading-3":
      return `<h3>${renderNodes(node.content)}</h3>`;
    case "heading-4":
      return `<h4>${renderNodes(node.content)}</h4>`;
    case "heading-5":
      return `<h5>${renderNodes(node.content)}</h5>`;
    case "heading-6":
      return `<h6>${renderNodes(node.content)}</h6>`;
    case "unordered-list":
      return `<ul>${renderNodes(node.content)}</ul>`;
    case "ordered-list":
      return `<ol>${renderNodes(node.content)}</ol>`;
    case "list-item":
      return `<li>${renderNodes(node.content)}</li>`;
    case "blockquote":
      return `<blockquote>${renderNodes(node.content)}</blockquote>`;
    case "hr":
      return "<hr>";
    case "table":
      return `<div class="table-wrap"><table class="data">${renderNodes(node.content)}</table></div>`;
    case "table-row":
      return `<tr>${renderNodes(node.content)}</tr>`;
    case "table-header-cell":
      return `<th scope="col">${renderNodes(node.content)}</th>`;
    case "table-cell":
      return `<td>${renderNodes(node.content)}</td>`;
    case "hyperlink": {
      const url = node.data?.uri || "#";
      const external = /^https?:\/\//i.test(url) && !url.includes("ynepf");
      const attrs = external ? ' target="_blank" rel="noopener"' : "";
      return `<a href="${escapeHtml(url)}"${attrs}>${renderNodes(node.content)}</a>`;
    }
    case "embedded-asset-block": {
      const asset = node.data?.target;
      const file = asset?.fields?.file;
      if (!file?.url) return "";
      const src = file.url.startsWith("//") ? `https:${file.url}` : file.url;
      const alt = escapeHtml(asset.fields.description || asset.fields.title || "");
      return `<img src="${escapeHtml(src)}" alt="${alt}">`;
    }
    default:
      // Unhandled node types (embedded entries, etc.) are skipped rather
      // than guessed at, so unexpected Contentful content never mangles
      // the page.
      return "";
  }
}

function renderRichText(document) {
  if (!document) return "";
  return renderNode(document);
}

module.exports = { renderRichText };
