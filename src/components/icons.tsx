'use client'

/**
 * Adaptador central de iconos: reexpone los iconos animados de
 * `@animateicons/react/lucide` bajo los mismos nombres que usábamos de
 * `lucide-react`, para que cada archivo solo cambie el import.
 *
 * - Los iconos animados renderizan un `<div>` (inline-flex) con un `<svg>`
 *   `stroke="currentColor"` → el color se hereda de las clases `text-*`.
 * - El tamaño va por prop `size` (px), no por `className`. Este wrapper
 *   traduce las clases `size-N` / `h-N` de Tailwind a `size` para no tener
 *   que tocar el JSX en cada sitio.
 * - Donde la librería no tiene el icono exacto, se usa uno RELACIONADO
 *   (ver el mapa abajo). Cobertura: 248 iconos curados.
 */

import type { HTMLAttributes } from 'react'
import {
  BookOpenIcon as _BookOpen,
  BrainIcon as _Brain,
  CheckIcon as _Check,
  ChevronDownIcon as _ChevronDown,
  ChevronLeftIcon as _ChevronLeft,
  ChevronRightIcon as _ChevronRight,
  ChevronUpIcon as _ChevronUp,
  CircleCheckIcon as _CircleCheck,
  CircleCheckBigIcon as _CircleCheckBig,
  CirclePlusIcon as _CirclePlus,
  ClipboardIcon as _Clipboard,
  CopyIcon as _Copy,
  CornerUpLeftIcon as _CornerUpLeft,
  DollarSignIcon as _DollarSign,
  DownloadIcon as _Download,
  EllipsisIcon as _Ellipsis,
  EllipsisVerticalIcon as _EllipsisVertical,
  ExternalLinkIcon as _ExternalLink,
  EyeIcon as _Eye,
  EyeOffIcon as _EyeOff,
  GitCompareIcon as _GitCompare,
  InfoIcon as _Info,
  LayersIcon as _Layers,
  LayoutGridIcon as _LayoutGrid,
  LoaderCircleIcon as _LoaderCircle,
  LogoutIcon as _Logout,
  MenuIcon as _Menu,
  MinusIcon as _Minus,
  MoonIcon as _Moon,
  MoveLeftIcon as _MoveLeft,
  MoveRightIcon as _MoveRight,
  ArrowDownUpIcon as _ArrowDownUp,
  BaggageClaimIcon as _BaggageClaim,
  BoltIcon as _Bolt,
  BoxIcon as _Box,
  BoxesIcon as _Boxes,
  ChevronsLeftIcon as _ChevronsLeft,
  ChevronsRightIcon as _ChevronsRight,
  HouseIcon as _House,
  PackageOpenIcon as _PackageOpen,
  PlusIcon as _Plus,
  SearchIcon as _Search,
  SendIcon as _Send,
  SettingsIcon as _Settings,
  ShieldCheckIcon as _ShieldCheck,
  ShieldXIcon as _ShieldX,
  ShoppingCartIcon as _ShoppingCart,
  SlidersHorizontalIcon as _SlidersHorizontal,
  SparklesIcon as _Sparkles,
  SunIcon as _Sun,
  Trash2Icon as _Trash2,
  TriangleAlertIcon as _TriangleAlert,
  UploadIcon as _Upload,
  XIcon as _X,
} from '@animateicons/react/lucide'

// ─── Tipos / wrapper ────────────────────────────────────────────────────

interface AnimatedIconProps extends Omit<HTMLAttributes<HTMLDivElement>, 'color'> {
  size?: number
  duration?: number
  isAnimated?: boolean
  color?: string
}

export type IconProps = Omit<HTMLAttributes<HTMLDivElement>, 'color'> & {
  size?: number
  color?: string
  /** Aceptado por compat con lucide; la librería animada no lo usa. */
  strokeWidth?: number
}

const SIZE_PX: Record<string, number> = {
  '3': 12, '3.5': 14, '4': 16, '5': 20, '6': 24, '7': 28,
  '8': 32, '9': 36, '10': 40, '12': 48, '14': 56, '16': 64,
}

/** Traduce la primera clase `size-N` / `h-N` / `w-N` a píxeles. Default 16. */
function sizeFromClass(cls?: string): number {
  if (!cls) return 16
  const m = cls.match(/(?:^|\s)(?:size|h|w)-(\d+(?:\.5)?)/)
  if (!m) return 16
  return SIZE_PX[m[1]] ?? Number(m[1]) * 4
}

function wrap(Cmp: React.ComponentType<AnimatedIconProps>) {
  return function Icon({ className, size, strokeWidth: _sw, ...rest }: IconProps) {
    void _sw // descartado: la librería animada no acepta strokeWidth
    return <Cmp size={size ?? sizeFromClass(className)} className={className} {...rest} />
  }
}

// ─── Exports (mismos nombres que lucide-react) ──────────────────────────
// Exactos
export const BookOpen = wrap(_BookOpen)
export const Brain = wrap(_Brain)
export const Check = wrap(_Check)
export const ChevronDown = wrap(_ChevronDown)
export const ChevronLeft = wrap(_ChevronLeft)
export const ChevronRight = wrap(_ChevronRight)
export const ChevronUp = wrap(_ChevronUp)
export const CircleCheck = wrap(_CircleCheck)
export const Copy = wrap(_Copy)
export const DollarSign = wrap(_DollarSign)
export const Download = wrap(_Download)
export const ExternalLink = wrap(_ExternalLink)
export const Eye = wrap(_Eye)
export const EyeOff = wrap(_EyeOff)
export const GitCompare = wrap(_GitCompare)
export const Info = wrap(_Info)
export const Menu = wrap(_Menu)
export const Moon = wrap(_Moon)
export const Plus = wrap(_Plus)
export const Search = wrap(_Search)
export const Send = wrap(_Send)
export const ShieldCheck = wrap(_ShieldCheck)
export const ShoppingCart = wrap(_ShoppingCart)
export const Sparkles = wrap(_Sparkles)
export const Sun = wrap(_Sun)
export const Trash2 = wrap(_Trash2)
export const TriangleAlert = wrap(_TriangleAlert)
export const Upload = wrap(_Upload)
export const X = wrap(_X)

// Relacionados (sin equivalente exacto en la librería)
export const AlertCircle = wrap(_TriangleAlert)
export const AlertTriangle = wrap(_TriangleAlert)
export const ArrowDown = wrap(_ChevronDown)
export const ArrowLeft = wrap(_MoveLeft)
export const ArrowRight = wrap(_MoveRight)
export const ArrowUp = wrap(_ChevronUp)
export const ArrowUpDown = wrap(_ArrowDownUp)
export const Ban = wrap(_X)
export const CalendarDays = wrap(_Info)
export const CheckCircle = wrap(_CircleCheck)
export const CheckCircle2 = wrap(_CircleCheckBig)
export const CheckSquare = wrap(_CircleCheck)
export const Circle = wrap(_LoaderCircle)
export const CircleHelp = wrap(_Info)
export const ClipboardList = wrap(_Clipboard)
export const Clock = wrap(_LoaderCircle)
export const Database = wrap(_Layers)
export const FileSpreadsheet = wrap(_LayoutGrid)
export const FileText = wrap(_Clipboard)
export const GripVertical = wrap(_EllipsisVertical)
export const Home = wrap(_House)
export const Library = wrap(_BookOpen)
export const ListFilter = wrap(_SlidersHorizontal)
export const Loader2 = wrap(_LoaderCircle)
export const LogOut = wrap(_Logout)
export const MoreHorizontal = wrap(_Ellipsis)
export const OctagonX = wrap(_ShieldX)
export const Package = wrap(_Box)
export const PackageCheck = wrap(_CircleCheck)
export const PackageSearch = wrap(_PackageOpen)
export const PanelLeftClose = wrap(_ChevronsLeft)
export const PanelLeftOpen = wrap(_ChevronsRight)
export const Pencil = wrap(_Settings)
export const PlusCircle = wrap(_CirclePlus)
export const RefreshCw = wrap(_LoaderCircle)
export const RotateCcw = wrap(_CornerUpLeft)
export const SeparatorHorizontal = wrap(_Minus)
export const Truck = wrap(_BaggageClaim)
export const Warehouse = wrap(_Boxes)
export const Wrench = wrap(_Bolt)
export const XCircle = wrap(_X)

// Alias con sufijo Icon (algunos archivos importan estos nombres)
export const CheckIcon = wrap(_Check)
export const ChevronDownIcon = wrap(_ChevronDown)
export const ChevronRightIcon = wrap(_ChevronRight)
export const ChevronUpIcon = wrap(_ChevronUp)
export const CircleCheckIcon = wrap(_CircleCheck)
export const InfoIcon = wrap(_Info)
export const Loader2Icon = wrap(_LoaderCircle)
export const OctagonXIcon = wrap(_ShieldX)
export const TriangleAlertIcon = wrap(_TriangleAlert)
export const XIcon = wrap(_X)
