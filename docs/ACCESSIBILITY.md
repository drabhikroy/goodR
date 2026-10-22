# Accessibility

The app aims to meet WCAG 2.2 at level AA, the common standard for accessible software, and to be comfortable to use with a keyboard, a screen reader, or low vision. This page lists what is in place and how it is checked.

There are five color vision palettes: standard, deuteranopia, protanopia, tritanopia, and monochrome. Each one comes in Light, Dark, and Paper. An automated audit runs more than 2,000 contrast checks against WCAG 2.2 AA, and also checks that states such as warning and error can still be told apart under simulated color vision deficiency. A palette changes the colors of the whole window, including buttons, links, focus rings, selections, status, code, and plots.

Color is never the only signal. Each state also has its own icon shape and words, such as a triangle and "did not run".

Other things that help:

- Appearance can follow the system, or be set to light or dark.
- Text can be sized from 90 to 150 percent, which scales the whole interface, controls included. Code has its own size, from 11 to 24 points.
- Every pointer target is at least 44 pixels tall, and a test checks this on every screen.
- Animation stops when the system asks for reduced motion, or when you turn on Reduce motion in Settings.
- Every control shows focus. Dialogs keep focus inside them while open and hand it back when they close. Menus move with the arrow keys and close with Escape. Everything can be done from the keyboard, through shortcuts and the command palette.
- Controls are labeled with words, not just icons, and every menu item shows its keyboard shortcut.
- Run results and status changes are announced to screen readers without moving focus, including what went wrong when a line fails. An assistant answer is announced once it is finished, not word by word.
- Controls have names and roles for screen readers, and every screen passes automated WCAG 2.2 A and AA checks with axe, in every appearance.

Automated checks catch a lot, but not everything. Reports from people who use VoiceOver or other assistive technology are especially welcome.
