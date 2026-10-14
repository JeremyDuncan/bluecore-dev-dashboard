-- Pandoc filter for Google Docs exported as .docx.
--
-- Google keeps in-document links (tables of contents, "jump to" links) but drops the
-- heading IDs they point to (e.g. #8ytwo5gt88oo). We re-point each such link at the
-- heading with the same text, using the anchor Docusaurus generates (github-slugger
-- rules). Links that match no heading become plain text instead of broken anchors.
-- Headings are shifted down one level (see collect_heading).
-- Images in formats browsers can't display (EMF/WMF/TIFF) are replaced by a note.

local slugs = {}      -- normalized heading text -> anchor
local slug_counts = {}

local function normalize(text)
  return text:lower():gsub('%s+', ' '):gsub('^ ', ''):gsub(' $', '')
end

local function slugify(text)
  local s = text:lower()
  for _, punct in ipairs({'“', '”', '‘', '’', '–', '—', '…', '•', '·'}) do
    s = s:gsub(punct, '')
  end
  -- github-slugger: drop ASCII punctuation except - and _, then each whitespace char becomes -
  s = s:gsub('[^%w%s%-_\128-\255]', ''):gsub('%s', '-')
  local count = slug_counts[s]
  slug_counts[s] = (count or -1) + 1
  if count then return s .. '-' .. (count + 1) end
  return s
end

-- Also shift headings down a level: the page title is the page's only H1 on the website,
-- so Google's "Heading 1" sections become H2 (and get anchors + a table-of-contents entry).
local function collect_heading(el)
  local text = pandoc.utils.stringify(el)
  local slug = slugify(text)
  local key = normalize(text)
  if slugs[key] == nil then slugs[key] = slug end
  el.level = math.min(el.level + 1, 6)
  return el
end

local function fix_link(el)
  if el.target:sub(1, 1) ~= '#' then return nil end
  local slug = slugs[normalize(pandoc.utils.stringify(el.content))]
  if slug then
    el.target = '#' .. slug
    return el
  end
  return el.content -- unwrap: keep the text, drop the dead link
end

local function fix_image(el)
  local ext = el.src:match('%.(%w+)$')
  if ext and ({emf = true, wmf = true, tif = true, tiff = true})[ext:lower()] then
    return pandoc.Emph({pandoc.Str('[image not shown: ' .. ext:upper() .. ' format]')})
  end
  return nil
end

return {
  {Header = collect_heading},
  {Link = fix_link, Image = fix_image},
}
