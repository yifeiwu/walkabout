// Central registry mapping semantic icon keys (referenced from `categories.ts`
// and the UI chrome) to raw Lucide SVG strings. Each Lucide icon is a 24x24
// stroke SVG using `stroke="currentColor"`, so colour is controlled entirely by
// the surrounding element's CSS `color` and size via a `svg { width/height }`
// rule. Only the icons imported here are bundled — the full set is tree-shaken
// away — so this stays a few KB. This module is client-only; `categories.ts`
// deliberately stores just the string keys so the server (API routes) never
// pulls Lucide in.
import {
  TrainFront,
  Bus,
  TrainTrack,
  Utensils,
  Coffee,
  Sandwich,
  Beer,
  ShoppingCart,
  Store,
  ShoppingBag,
  Trees,
  Blocks,
  Dumbbell,
  School,
  Baby,
  GraduationCap,
  Library,
  Users,
  Mail,
  Church,
  Pill,
  Stethoscope,
  Banknote,
  Fuel,
  Film,
  Music,
  Landmark,
  Image,
  FerrisWheel,
  MapPin,
  HeartPulse,
  Clapperboard,
  Search,
  X,
} from "lucide-static";

export const ICONS = {
  "train-front": TrainFront,
  bus: Bus,
  "train-track": TrainTrack,
  utensils: Utensils,
  coffee: Coffee,
  sandwich: Sandwich,
  beer: Beer,
  "shopping-cart": ShoppingCart,
  store: Store,
  "shopping-bag": ShoppingBag,
  trees: Trees,
  blocks: Blocks,
  dumbbell: Dumbbell,
  school: School,
  baby: Baby,
  "graduation-cap": GraduationCap,
  library: Library,
  users: Users,
  mail: Mail,
  church: Church,
  pill: Pill,
  stethoscope: Stethoscope,
  banknote: Banknote,
  fuel: Fuel,
  film: Film,
  music: Music,
  landmark: Landmark,
  image: Image,
  "ferris-wheel": FerrisWheel,
  "map-pin": MapPin,
  "heart-pulse": HeartPulse,
  clapperboard: Clapperboard,
  search: Search,
  x: X,
} as const;

export type IconKey = keyof typeof ICONS;

// Resolve an icon key to its SVG string. Falls back to an empty string for
// unknown keys so a missing mapping degrades gracefully rather than throwing.
export function iconSvg(key: string): string {
  return ICONS[key as IconKey] ?? "";
}
