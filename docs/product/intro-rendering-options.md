# StudioX opening: rendering options for Vega

Research date: 21 October 2026. Target: Vega SDK 0.24, React Native 0.83,
`@amazon-devices/react-native-kepler` 4.x. This is an implementation decision and
validation plan, not a record of device-tested behavior.

**Recommended flow: brief black OS splash → native composited StudioX title → Home.**

Keep the OS splash visually identical to the opening's black field. Once the app has
laid out and loaded its intro assets, dismiss the splash and run one continuous animation
timeline inside the app. This gives StudioX control over timing, sound, remote skip and
the transition to Home.

## Current state

[`Intro.tsx`](../../src/screens/Intro.tsx) is a roughly 2.8-second placeholder using
`Animated` opacity and transforms with the native driver. It draws a simple line for the
crack; it does not play either rendered intro. [`App.tsx`](../../src/App.tsx) routes from
intro to Home, handles BACK, and uses a module-level flag to skip the intro when the same
JavaScript runtime remains alive.

The separate v1/v2 media exports are visual iterations. The v3 proof was rendered offline with continuous masks and a 60 fps timeline.
The user rejected its rounded glass distortion; v4 replaces that with a reference-shaped
fracture plate and rigid polygonal title offsets. V5 retains that plate, replacing
the curtain-like reveal with distributed fragments, moving impact to 4.25 seconds,
and increasing rigid pane misalignment with a soft cool shadow. See
[the v5 setup](../../scripts/intro/README-v5.md). The v4 export passed its 600-frame,
60 fps encoding/timing checks; those checks do not establish artistic approval. An offline
export is not evidence that the eventual Vega implementation will achieve that frame
rate. The native compositor will require its own playback and performance checks.

## What Vega actually provides

| Route | Confirmed capability | Implication for StudioX |
| --- | --- | --- |
| OS splash | Native static or animated PNG sequence; lifecycle controlled by `SplashScreenManager` | Suitable for the short black launch field. The documented splash asset format is not MP4. |
| Native animated views | `Animated` native driver for supported properties; opacity and transforms are the conservative choice | Continuous letter reveal, tremor, reflection movement and overlapping fades can run without React rendering every frame. |
| Reanimated | Vega port supports UI-thread worklets, shared values, timing and animated styles/props | Optional if more elaborate masks need it; not required for basic layer transforms and fades. |
| SVG / MaskedView | Paths, clipping, alpha masks and gradients; a separately supported MaskedView library | Can divide the title into irregular optical regions and reveal pre-authored artwork. |
| Native media player | W3C media controller with a native video surface and hardware media pipeline | Video can be the first **in-app** screen. It is not limited to later content playback. |
| Live glass shader | No ready-made glass/refraction primitive or supported Skia port established by this research | Do not make the intro depend on an assumed graphics API. |

Amazon documents an animated splash as
`assets/raw/SplashScreenImages.zip`, containing `desc.txt` and
`_loop/loop00000.png` onward. The descriptor specifies dimensions and frame rate. TV
assets are 1920×1080; 4K splash assets are unsupported. The default dismissal occurs
when the first content frame is ready. The RN 0.83 hooks
`usePreventHideSplashScreen()` and `useHideSplashScreenCallback()` allow the root to
control that handoff. There is no audio-track or synchronized-audio mechanism documented
on this page. Do not assume one.
[SplashScreenManager](https://www.developer.amazon.com/docs/react-native-vega/0.83/splashscreenmanager)

The native driver receives the animation description before playback and performs
updates on the UI thread. Its documented limitation is non-layout properties: transforms
and opacity work; Flexbox and layout-position properties do not. Use fixed layout and
animated transforms rather than changing width, left or top every frame. The installed
Kepler 4.0.1+rn0.83.0 package also lists opacity and transforms in its native animation
allowlist.
[Animated](https://developer.amazon.com/docs/react-native-vega/0.83/animated),
[animation caveats](https://developer.amazon.com/docs/react-native-vega/0.83/animations)

For RN 0.83, the Vega Reanimated instructions specify
`@amazon-devices/react-native-reanimated ~4.0.0`,
`@amazon-devices/react-native-worklets ~1.0.0`, and the Worklets Babel plugin. The
documented exceptions include Fabric layout animations, CSS transitions/animations,
shared-element transitions and `useReducedMotion`. Prefer existing `Animated` until a
specific requirement justifies the additional setup.
[Vega Reanimated](https://developer.amazon.com/docs/vega-api/0.24/react-native-reanimated)

The SVG port supports `Path`, `ClipPath`, `Mask`, raster `Image`, and linear/radial
gradients. Its explicit exclusions include `Polygon`, `Polyline`, `Pattern` and
`ForeignObject`; represent shard silhouettes with `Path`. Filter exports found in the
installed JavaScript package do not establish that their native Vega implementations
work. Runtime Gaussian blur and displacement filters remain unverified.
[Vega SVG](https://www.developer.amazon.com/docs/vega-api/0.24/react-native-svg)

If needed, `@amazon-devices/react-native-masked-view__masked-view ~2.0.9000000002`
is documented for RN 0.83. Its support statement excludes the Android-only
`androidRenderingMode` prop.
[MaskedView](https://developer.amazon.com/docs/vega-api/0.24/react-native-masked-view)

## Make the glass convincing with a few carefully authored layers

This is an **optical approximation**, not live refraction of an arbitrary scene. The
background is black and the only content behind the glass is the StudioX wordmark,
so its refracted appearance can be prepared in advance.

1. Build the white wordmark and crimson X as independently controllable letters or
   stroke groups. Reveal them at approximately their final size using continuously
   moving masks and short, overlapping dissolves. Avoid switching between a few
   complete symbol poses.
2. Bake the restrained blue-white halo into a small transparent texture. It is part of
   the opening artwork, not a new blur or glass-card treatment for the normal UI.
   Keep the rest of the design language unchanged.
3. Give the fracture a dark inner split, opposing narrow bright edges, uneven
   branching and a few translucent reflective wedges. Its apparent width should vary;
   one uniformly luminous line reads as a drawn graphic.
4. Clip duplicate portions of the title to those wedge shapes and offset them slightly.
   This produces the discontinuity expected when viewing letters through fractured
   glass. Pair the displacement with localized highlights rather than adding a large
   generic frosted panel.
5. Propagate the crack quickly from bottom right toward top left. A short impact is
   intentional, but every surrounding exposure, tremor and fade must have continuous
   curves. Use a damped, low-amplitude screen tremor rather than unrelated random
   offsets on successive frames.
6. Fade letters over overlapping intervals with small irregular offsets. Let X remain
   visible only briefly after the other letters have become faint. Keep the exit
   continuous through black and into Home.

Use a single normalized timeline to derive the layer opacities/transforms. Keep geometry
and layout fixed while it runs. A prototype should start with a modest layer count,
cropped textures and no per-frame React state. A few pre-authored layers animated
continuously are materially different from swapping entire screenshots.

A native implementation does not automatically improve motion. If the authored timing
contains abrupt pose changes, it will still look abrupt at 60 fps. Judge the reveal and
exit in real-time playback, not only in contact sheets or individual frames.

## Video remains a valid alternative

Vega's W3C media pipeline uses native GStreamer components with hardware decoding and
rendering. Amazon lists MP4, H.264 and AAC support, subject to device capabilities.
`VideoPlayer` controls media while `KeplerVideoSurfaceView` supplies its rendering
surface. The app must initialize the player, attach the surface and dispose of both
correctly. This permits a full-screen intro as the first screen after launch.
[Vega media pipeline and formats](https://developer.amazon.com/docs/vega/0.24/media-player),
[player and surface lifecycle](https://developer.amazon.com/docs/vega/0.24/media-player-select-playback)

Amazon describes file-based as well as URL-based media playback. However, a working
packaged-MP4 URI and asset-copy configuration have not been verified in this project.
Do not call a specific `file:///pkg/assets/...` path tested until the built package and
runtime prove it.
[File-based media support](https://developer.amazon.com/docs/vega-api/0.24/porting-libraries)

A video keeps picture and sound on one media clock. Native compositing allows more
flexible interaction, but its separate audio player must be synchronized and tested.
Keep the high-quality render as the visual reference and as a fallback if the native
approximation cannot meet the desired appearance or audio alignment on the target TV.
Neither route is integrated by this document.

There is a version inconsistency in the public media instructions: the
[setup guide](https://developer.amazon.com/docs/vega/0.24/media-player-setup) specifies
`~2.1.80` and older Babel examples, while the
[0.24 API reference](https://developer.amazon.com/docs/vega-api/0.24/README.amazon-devices_react-native-w3cmedia)
specifies `~2.3.2`. The latter matches the existing architecture decision. Resolve
package compatibility against the RN 0.83 sample and installed exports before adding it;
do not paste the older Babel configuration over this app.

## Avoid unsupported shortcuts

The supported-library matrix lists Lottie, Reanimated, SVG and MaskedView for RN 0.83,
but explicitly marks Expo GL unsupported for this release. The release notes repeat
that restriction even though an Expo GL API page still contains shader examples.
Lottie may suit vector motion; its presence does not establish that a detailed
refraction composition will reproduce correctly.
[Supported libraries](https://developer.amazon.com/docs/vega-api/0.24/supported-libraries),
[Vega 0.24 release notes](https://developer.amazon.com/docs/vega/0.24/vega-release-notes)

The API named “Vega Graphics” queries or manages connected-display capabilities.
It is not documented as a custom glass shader renderer. No supported Skia integration
was established by this investigation; this is a research limitation, not a claim
that no future or privately ported implementation could exist.
[Vega API overview](https://www.developer.amazon.com/docs/vega-api/0.24/vega-apis-overview)

## Integration and validation gates

These are required future checks; none has been completed for the proposed intro.

- **Visual timing:** compare continuous real-time playback of the native prototype and
  offline proof. Inspect the first reveal, every mask handoff, the moment of impact,
  overlapping letter fades and the final black frame. No unintended frozen poses,
  black-frame flashes or source-image swaps.
- **Synchronization:** prepare assets and audio before starting the timeline. Start from
  one coordinated ready state, then measure the audible crack against the visual
  fracture on repeated cold launches. A JavaScript start callback is not a
  frame-accurate synchronization guarantee. If drift is noticeable or variable, revise
  the clock strategy or use the native video route.
- **Splash handoff:** root calls the splash hooks once and dismisses only after the
  intro surface and assets are ready. Do not launch the visible timeline behind a
  splash that is still covering it. Preserve black across the handoff.
- **Completion and skip:** SELECT/ENTER/PLAY-PAUSE and BACK terminate the intro promptly.
  Completion must be idempotent: natural end, remote skip, timeout and error can each
  request Home, but only one transition may occur. Home must receive the intended
  initial focus. Home and voice buttons retain system behavior.
- **Lifecycle:** on background, stop the animation and audio and release media resources.
  On a warm return, go to Home without replaying an abandoned sting. Test a destroyed
  surface, a retained runtime and a killed/restarted process separately; a module
  variable alone does not prove behavior across every lifecycle case.
- **Failure recovery:** missing artwork or media initialization failure must lead to
  Home within a bounded time. Test failures and repeated skip inputs without leaving
  audio, timers, event handlers or video surfaces alive.
- **Performance:** measure release-build frame pacing, CPU and peak/settled PSS on a
  physical target Fire TV. Start with cropped assets and bound overdraw. Confirm
  memory returns after completion and repeated launches. A 60 fps source, passing
  TypeScript or smooth desktop preview does not establish TV performance.
- **Verification record:** run relevant type/lint/unit checks, build the actual Vega
  package, test D-pad/BACK and lifecycle on VVD where available, then record hardware
  results separately. Never substitute VVD results for real-device measurements.

