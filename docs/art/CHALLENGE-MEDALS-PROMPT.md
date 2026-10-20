# 蚀刻章图集制作记录

使用内置 image_gen（imagegen 技能），不是外部 API/CLI 生成。随后使用 Sharp 进行尺寸与 WebP 编码优化，不改变图案。参考来源：[PRTS 蚀刻章图鉴](https://prts.wiki/w/PRTS:%E6%96%87%E4%BB%B6%E4%B8%80%E8%A7%88/%E8%9A%80%E5%88%BB%E7%AB%A0)。本图集为本项目原创生成章面，没有使用官方蚀刻章图片。

## 资产

- 游戏使用：`public/icons/challenge-medals-v2.webp`，768×512，137790 bytes，含透明 Alpha。
- 本地保留的生成源图：`output/imagegen/challenge-medals-v2-source.png`，1536×1024。该目录为本地制作输出，不要求纳入发布。
- 四列两行；依次为战线值守、后勤整备、重铸火力、无隙防御、协同协议、终局捷报、有限采购、协约履行章。
- 未获得效果由 CSS 灰度与亮度生成，不另外下载一套图片。
- 规则版本 3 实际使用：终局捷报取第二行第二枚旗帜章，无隙防御取第一行第四枚盾墙章，核心决胜取第二行第四枚大型城塞章，组合章取第二行第一枚协同双塔章。其余章面预留，最初生成主题不代表仍存在旧任务。

## 生成提示词

Create an ORIGINAL production game UI sprite atlas of eight richly designed etched achievement medals, inspired by the aesthetic language of Arknights etched medals (not official copies). This replaces overly simple outline icons. Strong graphic illustrative craft: substantial beveled engraved metal borders, dark gunmetal backing, layered enamel color fills, finely engraved technical linework, small relief silhouettes, angular industrial geometry, crisp strong central narrative symbols, subtle worn metal highlights, not photographic jewelry, no characters. Each is a detailed collectible plaque, predominantly hexagonal but with individual secondary stepped or cut corners. Avoid the same plain hexagon with a tiny line icon. No long fabric ribbons, no glow clouds, no words, no letters, no numbers, no logos, no watermarks. Real transparent background outside each medal, no checkerboard drawn in.

STRICT SPRITE LAYOUT: landscape canvas 1536 by 1024 pixels, EXACTLY FOUR EQUAL COLUMNS and TWO EQUAL ROWS. Each of the eight cells is exactly 384 wide by 512 high. Exactly one isolated badge perfectly centered in each cell, same visual bounding size approximately 300 wide by 330 high, generous identical transparent padding; no overlap between cells. No labels or captions. All badges fully visible and separate.

Reading order themes: row1 col1 FRONTLINE WATCH: a silhouetted fortified watchtower with narrow radiating beams, desaturated steel blue enamel and silver frame; row1 col2 LOGISTICS READINESS: a substantial tactical supply crate and wrench emblem layered over cargo stripes, mustard yellow enamel, bronze and silver frame; row1 col3 REFORGED FIREPOWER: two interlocking faceted alloy prisms above an anvil, ember orange accents and blackened copper frame; row1 col4 UNBROKEN DEFENSE: layered defensive shield over three bastion teeth, deep crimson enamel and polished silver chamfers. Row2 col1 COOPERATION PACT: two fortified towers connected by a geometric bridge and a compact central star, turquoise and jade enamel with brushed silver; row2 col2 FINAL DISPATCH: a flag atop a strong angular citadel surrounded by a restrained geometric laurel, ivory and warm gilded metal with muted navy background; row2 col3 LIMITED PROCUREMENT: stacked coins balanced beneath a precise compass/triangular procurement insignia, brass and charcoal with restrained amber accents; row2 col4 PACT FULFILLED collection medal: the largest-looking but same bounding size prestigious many-layered central citadel crest flanked by architectural wing plates and a four-point star, antique gold, ivory, black and deep teal accents. Each badge should look recognizably part of one tactical collection, but unique in its detailed silhouette, iconography, relief and enamel palette. High quality, readable at 80px display size, polished game-ready atlas.

## 透明背景修订提示词

This is a production sprite atlas. Preserve all eight existing badges EXACTLY: retain their illustration, color, sharp detail, shape, size, positions, four-column/two-row layout and current canvas size. EDIT ONLY the background outside the hard exterior boundaries of each metal badge. Remove every gray/brown/black blurred backdrop, glow and cast shadow between and around the eight badges, replacing all of it with actual transparent alpha pixels. Badge enamel interior backgrounds remain intact and opaque. No backdrop gradient, no checkerboard texture, no plate behind the grid. Each badge must be an isolated crisp cutout on a fully transparent canvas, especially in all margins and all gaps between badges. Do not redesign, add, crop, move or resize any badge. No text.
