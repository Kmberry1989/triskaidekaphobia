# Main menu art slots

Replace these files in place; the menu layout and interactions do not depend on their contents.

| File | Role | Delivery spec |
| --- | --- | --- |
| `main-menu-background.png` | Full-screen image behind the lobby UI | 1536x2048 PNG or larger, portrait 3:4, dark elevator/shaft atmosphere, no text or logos, leave the center-lower region calm enough for controls. |
| `menu-options-underlay.svg` | Transparent linework directly underneath the four option cards | 640x480 viewBox, no baked text. |
| `menu-title-mark.svg` | Small decorative mark beside the title | 360x180 viewBox, transparent, no baked text. |

`main-menu-background.svg` is the current source template for the shipped PNG. It can be replaced with an SVG if desired, but retain the PNG filename for the active menu background without changing CSS.
