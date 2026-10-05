# NumPicker provenance

NumPicker is a Mezfit UI Kit primitive derived from the approved TimePicker interaction model.

It does not introduce a second wheel or lens implementation. TimePicker and NumPicker both compose the internal `TwoColumnPicker` core, which owns:
- MezfitPopover anchoring and open/close mechanics;
- the existing two-ribbon scroll behavior;
- the approved TimePicker lens and Liquid Glass shell, including the automatic iOS scale fallback;
- controlled-value reconciliation;
- Telegram selection haptic dispatch.

NumPicker changes only the domain mapping presented by that shared mechanism:
- left ribbon: empty hundreds, 1, 2, 3;
- right ribbon: 00 through 99;
- public value: integer 0 through 399.

No Konsta private DOM or CSS mechanics are modified.
