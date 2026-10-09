# Theme tokens (mockup v0.4, based on Sneat free v3.0.0, MIT)

Base: Sneat `scss/_bootstrap-extended/_variables.scss`. Overrides below are needed to meet WCAG AA (4.5:1) for normal text (NFR-15).

| Token | Sneat default | Our value | Contrast on white | Contrast on its badge tint |
|---|---|---|---|---|
| primary (buttons, links, active nav) | #696cff (4.05) | #5355e0 | 5.61 | 4.61 on #e7e7ff |
| secondary (muted badges, outline buttons) | #8592a3 (3.16) | #5d6878 | 5.65 | 4.85 on #ebeef0 |
| success (On track, Signed, Completed) | #71dd37 (1.74) | #2e7d17 | 5.17 | 4.72 on #e8fadf |
| danger (Delayed, Blocked, errors) | #ff3e1d (3.52) | #b8240a | 6.37 | 5.14 on #ffe0db |
| warning (At risk, Client, Requested) | #ffab00 (1.90) | #9a5b00 | 5.43 | 4.89 on #fff2d6 |
| info (Milestone, In Progress, Submitted) | #03c3ec (2.10) | #00718a | 5.63 | 4.92 on #d7f5fc |
| body text | #646e78 | unchanged | 5.19 | |
| heading text | #384551 | unchanged | | |
| page background | #f5f5f9 | unchanged | | |

Badge tints = Sneat default colour at 16% over white (Sneat `bg-label-*` style). Badges always carry a text label; status is never colour-only.
Font: Public Sans 400/500/600/700. Radius: 0.375rem. Card shadow: 0 .1875rem .5rem rgba(0,0,0,.1). Sidebar: white, 260px, active item = primary text on #e7e7ff.
