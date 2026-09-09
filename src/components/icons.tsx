'use client'

/** Re-exposes @animateicons under lucide names (or a RELATED one when missing),
 *  maps size-N/h-N classes to the `size` prop, animating from the hovered ancestor. */

import { useEffect, useRef, type HTMLAttributes, type ForwardRefExoticComponent, type RefAttributes } from 'react'
import {
  BlocksIcon as _Blocks,
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
  HeadphonesIcon as _Headphones,
  HeadphonesOffIcon as _HeadphonesOff,
  InfoIcon as _Info,
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


interface AnimatedIconProps extends Omit<HTMLAttributes<HTMLDivElement>, 'color'> {
  size?: number
  duration?: number
  isAnimated?: boolean
  color?: string
}

interface IconHandle {
  startAnimation: () => void
  stopAnimation: () => void
}

type AnimatedIcon = ForwardRefExoticComponent<AnimatedIconProps & RefAttributes<IconHandle>>

export type IconProps = Omit<HTMLAttributes<HTMLDivElement>, 'color'> & {
  size?: number
  color?: string
  /** Accepted for lucide compat; the animated library ignores it. */
  strokeWidth?: number
}

const SIZE_PX: Record<string, number> = {
  '3': 12, '3.5': 14, '4': 16, '5': 20, '6': 24, '7': 28,
  '8': 32, '9': 36, '10': 40, '12': 48, '14': 56, '16': 64,
}

/** Maps the first `size-N` / `h-N` / `w-N` class to pixels. Default 16. */
function sizeFromClass(cls?: string): number {
  if (!cls) return 16
  const m = cls.match(/(?:^|\s)(?:size|h|w)-(\d+(?:\.5)?)/)
  if (!m) return 16
  return SIZE_PX[m[1]] ?? Number(m[1]) * 4
}

function wrap(Cmp: AnimatedIcon) {
  return function Icon({ className, size, strokeWidth: _sw, ...rest }: IconProps) {
    void _sw // dropped: the animated library takes no strokeWidth
    const handleRef = useRef<IconHandle | null>(null)
    const spanRef = useRef<HTMLSpanElement | null>(null)

    // Animate from the interactive ancestor (button/link), or from the icon when
    // loose. Passing the ref disables its internal auto-hover, so no double fire.
    useEffect(() => {
      const span = spanRef.current
      if (!span) return
      // The <span> is display:contents (no box), so the loose case listens on the
      // icon's <div> child, which does have one.
      const trigger =
        (span.closest('button, a, [role="button"], label') as HTMLElement | null) ??
        (span.firstElementChild as HTMLElement | null) ??
        span
      const enter = () => handleRef.current?.startAnimation()
      const leave = () => handleRef.current?.stopAnimation()
      trigger.addEventListener('mouseenter', enter)
      trigger.addEventListener('mouseleave', leave)
      return () => {
        trigger.removeEventListener('mouseenter', enter)
        trigger.removeEventListener('mouseleave', leave)
      }
    }, [])

    // Props go to the animated component; the <span> is only a DOM anchor for hover.
    return (
      <span ref={spanRef} style={{ display: 'contents' }}>
        <Cmp
          ref={handleRef}
          size={size ?? sizeFromClass(className)}
          className={className}
          {...rest}
        />
      </span>
    )
  }
}

// Exact lucide names
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
export const Headphones = wrap(_Headphones)
export const HeadphonesOff = wrap(_HeadphonesOff)
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

// Related: no exact equivalent in the library
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
export const Database = wrap(_Blocks)
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
// Straight from lucide: no generic pencil in the animated set, and its gear read as "settings" (#55).
export { Pencil } from 'lucide-react'
// Same as Pencil: no scissors in the animated library (#59).
export { Scissors } from 'lucide-react'
// Same: no printer among the 248 animated icons (#64).
export { Printer } from 'lucide-react'
// Same: no ruler among the animated icons (#71).
export { Ruler } from 'lucide-react'
// Same: no receipt among the animated icons (#84).
export { Receipt } from 'lucide-react'
// Same: no history icon among the animated ones.
export { History } from 'lucide-react'
// Same: the animated Clock is a spinner and CalendarDays maps to Info (#93).
export { CalendarClock } from 'lucide-react'
// Same: no team/users icon among the animated ones (#93).
export { Users } from 'lucide-react'
export const PlusCircle = wrap(_CirclePlus)
export const RefreshCw = wrap(_LoaderCircle)
export const RotateCcw = wrap(_CornerUpLeft)
export const SeparatorHorizontal = wrap(_Minus)
export const Truck = wrap(_BaggageClaim)
export const Warehouse = wrap(_Boxes)
export const Wrench = wrap(_Bolt)
export const XCircle = wrap(_X)

// Icon-suffixed aliases: some files import these names.
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
