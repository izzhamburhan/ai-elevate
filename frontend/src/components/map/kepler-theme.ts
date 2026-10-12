import { theme as themeDK, themeLT } from "@kepler.gl/styles";

/**
 * kepler.gl theme mapped onto the app's design tokens (the palette in globals.css).
 * kepler renders with styled-components, so it needs literal values rather
 * than CSS variables for anything it runs through color math.
 */
const lightTokens = {
  ink: "#1f1b2d",
  inkSoft: "#3c384b",
  muted: "#59566a",
  line: "#e6e5ea",
  surface: "#ffffff",
  subtle: "#f6f5f8",
  hover: "#f0eff1",
  pressed: "#e6e4ea",
  brand: "#bd9fff",
  brandHover: "#cdb6ff",
  brandForeground: "#1b1528",
  brandSoft: "#efe9ff",
  brandStrong: "#6d4aff",
  primaryHover: "#3a3549",
  primaryActive: "#000000",
  font: "var(--font-sans), Inter, ui-sans-serif, system-ui, sans-serif",
  radius: "10px",
  shadow:
    "0 4px 12px -2px rgb(0 0 0 / 0.06), 0 1px 2px rgb(0 0 0 / 0.04), 0 0 0 1px #e6e5ea",
};

type Tokens = typeof lightTokens;

/**
 * Mirrors the `.dark` tokens in globals.css (hairlines flattened to opaque hex for color math).
 * The panel itself is night, like the page; the cards inside it are the raised night surfaces.
 */
const darkTokens: Tokens = {
  ink: "#fafafa",
  inkSoft: "#d6d4dd",
  muted: "#b3b0bf",
  line: "#2c2934",
  surface: "#14111d",
  subtle: "#1c1927",
  hover: "#25212f",
  pressed: "#2e2a39",
  brand: "#bd9fff",
  brandHover: "#cdb6ff",
  brandForeground: "#1b1528",
  brandSoft: "#2a2140",
  brandStrong: "#b79bff",
  primaryHover: "#e4e2ea",
  primaryActive: "#ffffff",
  font: lightTokens.font,
  radius: lightTokens.radius,
  shadow: "0 4px 12px -2px rgb(0 0 0 / 0.5), 0 1px 2px rgb(0 0 0 / 0.4), 0 0 0 1px #2c2934",
};

const makeKeplerTheme = (base: typeof themeLT, tokens: Tokens) => ({
  ...base,

  // typography
  fontFamily: tokens.font,
  btnFontFamily: tokens.font,
  effectPanelAddEffectFontFamily: tokens.font,
  textColor: tokens.inkSoft,
  textColorHl: tokens.ink,
  titleTextColor: tokens.ink,
  subtextColor: tokens.muted,
  subtextColorActive: tokens.ink,
  labelColor: tokens.muted,
  labelHoverColor: tokens.ink,
  axisFontColor: tokens.muted,
  logoColor: tokens.brandStrong,

  // accent
  activeColor: tokens.brandStrong,
  activeColorHover: tokens.brand,

  // surfaces
  sidePanelBg: tokens.surface,
  sidePanelHeaderBg: tokens.surface,
  sidePanelBorderColor: tokens.line,
  panelBackground: tokens.subtle,
  panelContentBackground: tokens.subtle,
  panelBackgroundHover: tokens.hover,
  panelBorderColor: tokens.line,
  panelHeaderIconActive: tokens.ink,
  panelHeaderIconHover: tokens.ink,
  panelBoxShadow: tokens.shadow,
  mapPanelBackgroundColor: tokens.surface,
  mapPanelHeaderBackgroundColor: tokens.subtle,
  bottomWidgetBgd: tokens.surface,
  // panel titles ("Layers", "Base map") at the panel-title size; weight and tracking are set in
  // globals.css, since kepler hard-codes them
  sidePanelTitleFontsize: "18px",
  chickletBgd: tokens.hover,
  boxShadow: tokens.shadow,
  borderRadius: "8px",

  // inputs & selects
  inputBgd: tokens.subtle,
  inputBgdHover: tokens.surface,
  inputBgdActive: tokens.surface,
  inputBgdActiveLT: tokens.surface,
  inputBorderColor: tokens.subtle,
  inputBorderHoverColor: tokens.line,
  inputBorderActiveColor: tokens.brand,
  inputBorderRadius: tokens.radius,
  inputColor: tokens.ink,
  inputPlaceholderColor: tokens.muted,
  secondaryInputBgd: tokens.subtle,
  secondaryInputBgdHover: tokens.surface,
  secondaryInputBgdActive: tokens.surface,
  secondaryInputColor: tokens.ink,
  secondaryInputBorderActiveColor: tokens.brand,
  selectColor: tokens.ink,
  selectBorderRadius: tokens.radius,

  // dropdowns & tooltips
  dropdownListBgd: tokens.surface,
  dropdownListHighlightBg: tokens.hover,
  dropdownListBorderTop: tokens.line,
  toolbarItemBgdHover: tokens.hover,
  toolbarItemIconHover: tokens.ink,
  tooltipBg: tokens.ink,
  tooltipColor: tokens.surface,

  // buttons — dark primary, lavender CTA, light secondary (as in Ideogram)
  primaryBtnBgd: tokens.ink,
  primaryBtnActBgd: tokens.primaryActive,
  primaryBtnBgdHover: tokens.primaryHover,
  primaryBtnColor: tokens.surface,
  primaryBtnActColor: tokens.surface,
  // pill buttons, as on the site
  primaryBtnRadius: "999px",
  secondaryBtnBgd: tokens.hover,
  secondaryBtnActBgd: tokens.pressed,
  secondaryBtnBgdHover: tokens.pressed,
  secondaryBtnColor: tokens.ink,
  secondaryBtnActColor: tokens.ink,
  ctaBtnBgd: tokens.brand,
  ctaBtnBgdHover: tokens.brandHover,
  ctaBtnActBgd: tokens.brandHover,
  ctaBtnColor: tokens.brandForeground,
  ctaBtnActColor: tokens.brandForeground,
  linkBtnActColor: tokens.ink,
  floatingBtnBgd: tokens.surface,
  floatingBtnActBgd: tokens.hover,
  floatingBtnBgdHover: tokens.hover,
  floatingBtnColor: tokens.inkSoft,
  floatingBtnActColor: tokens.ink,
  floatingBtnBorder: `1px solid ${tokens.line}`,
  floatingBtnBorderHover: `1px solid ${tokens.line}`,
  // map controls get the icon-tile radius, like the zoom group in the site's workspace mock
  floatingBtnRadius: tokens.radius,
  sideBarCloseBtnBgd: tokens.surface,
  sideBarCloseBtnColor: tokens.ink,
  sideBarCloseBtnBgdHover: tokens.hover,

  // switches, checkboxes, sliders, histograms
  switchTrackBgd: tokens.line,
  switchTrackBgdActive: tokens.brandStrong,
  switchBtnBgd: tokens.surface,
  switchBtnBgdActive: tokens.surface,
  secondarySwitchTrackBgd: tokens.line,
  secondarySwitchBtnBgd: tokens.surface,
  checkboxBoxBgdChecked: tokens.brandStrong,
  radioButtonBgdColor: tokens.brandStrong,
  sliderBarColor: tokens.brandStrong,
  sliderBarBgd: tokens.line,
  sliderBarHoverColor: tokens.brand,
  sliderHandleColor: tokens.surface,
  sliderHandleHoverColor: tokens.surface,
  sliderHandleTextColor: tokens.ink,
  sliderInactiveBorderColor: tokens.line,
  rangeBrushBgd: tokens.line,
  histogramFillInRange: tokens.brand,
  histogramFillOutRange: tokens.line,
  progressBarColor: tokens.brandStrong,
  progressBarTrackColor: tokens.line,

  // kepler sizes the panel box as width + 2 × margin.left but pads it by margin.right, so an
  // uneven margin squeezes the panel (and lets wide panels grow). Keep both sides equal so
  // every tab renders at exactly `sidePanelWidth`.
  sidePanel: {
    ...base.sidePanel,
    margin: { ...base.sidePanel.margin, right: base.sidePanel.margin.left },
  },
});

export const keplerLightTheme = makeKeplerTheme(themeLT, lightTokens);
export const keplerDarkTheme = makeKeplerTheme(themeDK as typeof themeLT, darkTokens);
