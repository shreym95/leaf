"""
Normalizer: turns arbitrary EPUB chapter XHTML into a clean, semantic structure
that our injected CSS can style consistently. Grounded in real Standard Ebooks markup.
This is a Python proof of the logic; in the app the same logic runs in JS over the
epubjs-rendered DOM (or as a pre-processing pass at import).
"""
from bs4 import BeautifulSoup
import warnings, re, html as ihtml
warnings.filterwarnings('ignore')

def normalize_chapter(xhtml, book_title, author, chapter_index, total_chapters):
    soup = BeautifulSoup(xhtml, 'lxml')
    sec = soup.find(['section','article']) or soup.find('body') or soup

    # --- 1. Extract heading info (tiered) ---
    ordinal, title = None, None
    hg = sec.find('hgroup')
    if hg:
        h = hg.find(['h1','h2','h3','h4','h5','h6'])
        t = hg.find(attrs={'epub:type': re.compile('title')}) or hg.find('p')
        if h: ordinal = h.get_text(' ', strip=True)
        if t: title = t.get_text(' ', strip=True)
    else:
        h = sec.find(['h1','h2','h3','h4','h5','h6'])
        if h:
            raw = h.get_text(' ', strip=True)
            # "Chapter V" -> ordinal only, no title. A titled heading stays as title.
            if re.match(r'^(chapter|part|book|letter)\b', raw, re.I) or re.match(r'^[IVXLC]+$', raw):
                ordinal = raw
            else:
                title = raw

    # --- 2. Collect body paragraphs (drop the heading itself) ---
    if hg: hg.decompose()
    elif h: h.decompose()
    paras = sec.find_all('p', recursive=True)

    # --- 3. Emit clean semantic HTML with OUR classes ---
    out = ['<article class="chapter">']
    out.append('  <header class="chapter-head">')
    if ordinal: out.append(f'    <p class="chapter-ordinal">{ihtml.escape(ordinal)}</p>')
    if title:   out.append(f'    <h1 class="chapter-title">{ihtml.escape(title)}</h1>')
    if not ordinal and not title:
        out.append('    <p class="chapter-ordinal">§</p>')  # graceful fallback
    out.append('  </header>')

    for i, p in enumerate(paras):
        # preserve inline emphasis but strip publisher classes/styles
        for tag in p.find_all(True):
            attrs = {}
            if tag.name in ('em','i','strong','b','a'):
                pass
            tag.attrs = attrs
        inner = ''.join(str(c) for c in p.contents).strip()
        cls = 'para first' if i == 0 else 'para'
        out.append(f'  <p class="{cls}">{inner}</p>')
    out.append('</article>')

    return '\n'.join(out), {'ordinal': ordinal, 'title': title,
                            'has_title': bool(title), 'n_paras': len(paras)}

if __name__ == '__main__':
    cases = [
        ('chapter-5.xhtml', 'Frankenstein', 'Mary Shelley', 5, 24),
        ('oz-chapter-1.xhtml', 'The Wonderful Wizard of Oz', 'L. Frank Baum', 1, 24),
    ]
    for path, bt, au, idx, tot in cases:
        norm, meta = normalize_chapter(open(path).read(), bt, au, idx, tot)
        print(f'\n===== {path} =====')
        print('META:', meta)
        print(norm[:520], '...')
