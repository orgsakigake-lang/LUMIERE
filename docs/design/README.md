# Gallery design verification

See the [release verification report](verification.md) for final checks and
deployment boundaries.

The gallery uses warm paper and olive surfaces, editorial serif headings, an
artwork-first collection, and an optional light-filled 3D room. The phone header
keeps both exhibition and collection navigation visible; collection captions
remain readable, and the artwork viewer keeps its close control visible while
scrolling. The original museum and curator workspace remain available.

- [Desktop entrance](desktop.png), 1440 px wide.
- [Phone collection](mobile-collection.png), 375 px wide.
- [Phone artwork viewer](mobile-viewer.png), 375 px wide.

Checked with Chromium and axe-core 4.12.1. Desktop entrance and phone collection:
zero violations, with contrast checks requiring manual review for decorative
arrows, the image label, and the small collection count. Phone artwork dialog:
zero violations and zero incomplete checks. Text/surface contrast calculations:
primary 12.25:1, secondary 5.19:1, primary button 9.24:1. Screenshots were inspected,
including the viewer after scrolling. This is not a physical-phone or full
assistive-technology certification.

The separate 3D runtime remains a preview. Its functional browser tests cover
WebGL failure, canceled entry, context loss, guided/free navigation, paused
rendering, audio controls, mobile navigation, and private-gallery routing.
