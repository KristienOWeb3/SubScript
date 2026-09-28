"use client";

import React from "react";

type IconSize = number | string;

export type KoboyoIconProps = Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> & {
  color?: string;
  mirrored?: boolean;
  size?: IconSize;
  strokeWidth?: number | string;
  weight?: string;
};

export type LucideIcon = React.ComponentType<KoboyoIconProps>;

export type TransactionIconProps = React.SVGProps<SVGSVGElement>;

export function KycVerificationPendingIcon({
  className,
  "aria-label": ariaLabel = "verification pending clock",
  ...props
}: TransactionIconProps) {
  return (
    <svg
      {...props}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      aria-label={ariaLabel}
      viewBox="0 0 167 166"
    >
      <path d="M57.5 12.1c-11.4 6-21.4 9.8-33.2 12.4-11.5 2.6-15 4.3-15.9 7.9-.3 1.3-.4 13.8-.2 27.7l.3 25.4 3.2 9.2a79 79 0 0 0 26 37.4C46.4 139 61.8 147 66.5 147c3.5 0 14.8-4.6 19.5-8l2.8-2 2.8 4.1a36 36 0 0 0 30.9 16.3c8.5 0 14-1.8 21.5-6.9 8.6-6 15-18.9 15-30.4 0-17.4-12-32.9-28.4-36.6l-5-1.1.3-24.1c.4-31.4.9-30.2-16.4-33.8a148 148 0 0 1-33.2-12.4A61 61 0 0 0 66.6 8c-.8 0-4.9 1.8-9.1 4.1m20.9 5.8q16.3 7.9 33.3 11.7c10.4 2.3 10.3 2 10.2 24.4 0 10.2-.4 20.7-.7 23.5l-.7 5-4.5.6a38 38 0 0 0-30.6 39.3c.3 3.4.8 7.3 1.2 8.7.6 2.5.1 2.9-8.6 7.3a57 57 0 0 1-11.3 4.6c-3.4 0-17.6-7.5-25.2-13.3A76 76 0 0 1 13.1 82c-1.6-9.5-1.4-47.2.2-49.3.7-.9 4.5-2.3 9-3.2 10.4-2.1 23.2-6.7 33.7-12.1 4.7-2.3 9.4-4.3 10.4-4.3 1.1-.1 6.5 2.1 12 4.8m55 70.7a39 39 0 0 1 18.3 17.2c2.4 4.9 2.8 6.9 2.8 14.2a30 30 0 0 1-9.6 23.9c-7.2 6.8-11.8 8.6-22.9 8.6-10.6 0-14.7-1.5-21.9-8a33.5 33.5 0 0 1 11.8-56.1c5-1.8 15.8-1.7 21.5.2" />
      <path d="M75.8 74.2 59.2 91.5l-8.4-8.3Q39.1 71.7 39 76.3C39 77.6 57.8 97 59.1 97c1.2 0 36.4-36.9 36.4-38.3 0-3.9-4.5-.3-19.7 15.5m43.7 26a81 81 0 0 0-.3 11.9l.3 10.4h10c8.7 0 10-.2 10.3-1.8.3-1.5-.6-1.7-8.2-1.7h-8.5l-.3-9.7q-.3-9.8-1.5-10.1t-1.8 1" />
    </svg>
  );
}

export function IncomingTransactionIcon({ className, ...props }: TransactionIconProps) {
  return (
    <svg
      {...props}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 153 159"
      fill="currentColor"
    >
      <path d="M74.7 7.6c-.4.4-.7 17.9-.7 38.8v38.1l-8.8-8.8a57 57 0 0 0-9.9-8.7q-1 .1-1.7 1.6c-.5 1.2 2.6 4.9 10.6 13A82 82 0 0 0 76.7 93a132 132 0 0 0 22.8-23.8c0-3.9-3.5-1.9-11.8 6.7l-8.7 9-.1-28.2c-.2-42-1.1-52.2-4.2-49.1" />
      <path d="M19 81.7c-2.5 2.4-3.6 5.2-7 17.5a79 79 0 0 0-4 29.3V143l3.4 3.8 3.4 3.7 59.4.3c40.2.2 60.5 0 63-.8 7-2 7.8-4.2 7.8-21.4 0-14.5-.2-15.7-3.9-29.2-2.1-7.8-4.4-15.1-5-16.3-1.8-3.2-4.4-4.1-12.5-4.1-6.8 0-7.6.2-7.6 1.9 0 2.5 2.2 3.2 8.8 2.9q5.3-.3 6.6 1.2c.8.8 2.8 6.7 4.5 13.1s3.3 12.3 3.7 13.2c.6 1.6-1.4 1.7-23 1.7H93l-1.9 3.8c-6.1 11.9-23.3 11.4-29.6-.8l-1.5-3-23.4-.2-23.3-.3 3.7-13c2-7.2 4-13.6 4.4-14.3s3.3-1.2 7.5-1.2c4.8 0 7.2-.4 8.1-1.5 2.1-2.5.1-3.5-7.5-3.5-6.8 0-7.8.3-10.5 2.7m39 37.6c0 .7 1.5 2.7 3.3 4.5a21.6 21.6 0 0 0 31.9-1.7l3.5-4.1h44.5l-.4 12.1c-.3 11.3-.5 12.2-2.7 14s-4.8 1.9-61.7 1.9c-58.1 0-59.4 0-61.4-2-1.8-1.8-2-3.3-2-14v-12h22.5c17.8 0 22.5.3 22.5 1.3" />
    </svg>
  );
}

export function OutgoingTransactionIcon({ className, ...props }: TransactionIconProps) {
  return (
    <svg
      {...props}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 283 283"
      fill="currentColor"
      preserveAspectRatio="xMidYMid meet"
    >
      <g transform="translate(0 242) scale(0.1 -0.1)">
        <path d="M953 1815 c-70 -30 -69 -77 6 -219 135 -257 156 -295 203 -374 27 -45 59 -87 71 -93 11 -7 75 -16 142 -20 67 -5 139 -12 160 -16 34 -8 25-11-101-36-77-16-151-30-166-32-72-10-104-52-265-342-200-358-223-424-167-480 23-23 31-25 82-20 86 8 182 52 1005 463 560 280 670 338 698 371 24 27 31 70 19 108-18 54-54 76-375 225-100 46-502 220-520 224-5 2-21 8-35 13-14 6-68 28-120 48-52 21-108 43-125 50-137 57-363 130-430 138-33 4-61 2-82-8z m111-81c34-9 70-20 81-25 11-4 56-20 100-35 44-15 85-30 90-34 6-4 42-18 80-30 39-12 75-26 80-30 6-3 33-15 60-24 28-10 68-27 90-37 22-10 96-41 165-69 151-63 398-169 500-217 201-94 241-115 247-129 9-25-23-48-168-122-545-280-871-444-1039-523-107-50-235-110-285-134-103-48-164-70-172-61-10 10 154 331 292 571 55 97 71 109 150 118 33 4 114 21 215 43 36 8 79 17 97 19 17 2 51 9 75 16 24 6 54 13 68 15 14 2 44 9 65 16 32 11 40 18 40 38 0 22-6 26-55 37-30 6-127 19-215 28-88 9-202 20-254 26-90 9-121 20-121 41 0 5-26 55-59 111-95 166-211 393-204 400 9 9 8 9 77-9zM392 1278c-28-14-26-48 3-65 14-9 96-12 288-13 253 0 268 1 287 20 20 20 18 47-4 62-18 12-548 8-574-4zM198 999c-21-12-23-42-4-58 9-8 121-10 391-9 347 3 379 4 389 21 8 12 8 22 0 35-10 16-41 17-385 19-242 2-380-1-391-8z" />
      </g>
    </svg>
  );
}

const iconSize = (size: IconSize | undefined) => {
  if (size === undefined) return "1em";
  return typeof size === "number" ? String(size) + "px" : size;
};

const koboyo = (name: string): LucideIcon => {
  const Icon = React.forwardRef<HTMLSpanElement, KoboyoIconProps>(
    (
      {
        "aria-label": ariaLabel,
        className,
        color,
        mirrored = false,
        size,
        strokeWidth: _strokeWidth,
        style,
        weight: _weight,
        ...props
      },
      ref,
    ) => {
      const assetUrl = "/icons/koboyo/" + name + ".svg";
      const maskUrl = 'url("' + assetUrl + '")';
      const iconStyle = {
        "--koboyo-icon-size": iconSize(size),
        WebkitMaskImage: maskUrl,
        maskImage: maskUrl,
        ...(color ? { color } : {}),
        ...(mirrored ? { transform: "scaleX(-1)" } : {}),
        ...style,
      } as React.CSSProperties;

      return (
        <span
          {...props}
          ref={ref}
          aria-hidden={ariaLabel ? undefined : true}
          aria-label={ariaLabel}
          className={["koboyo-icon", className].filter(Boolean).join(" ")}
          data-icon={name}
          style={iconStyle}
        />
      );
    },
  );

  Icon.displayName = name;
  return Icon;
};

export const Activity = koboyo("Activity");
export const AlertCircle = koboyo("AlertCircle");
export const AlertTriangle = koboyo("AlertTriangle");
export const ArrowDown = koboyo("ArrowDown");
export const ArrowDownToLine = koboyo("ArrowDownToLine");
export const ArrowLeft = koboyo("ArrowLeft");
export const ArrowRight = koboyo("ArrowRight");
export const ArrowRightLeft = koboyo("ArrowRightLeft");
export const ArrowUp = koboyo("ArrowUp");
export const ArrowUpRight = koboyo("ArrowUpRight");
export const Award = koboyo("Award");
export const Bell = koboyo("Bell");
export const BarChart3 = koboyo("BarChart3");
export const BookOpen = koboyo("BookOpen");
export const Building2 = koboyo("Building2");
export const Calendar = koboyo("Calendar");
export const Camera = koboyo("Camera");
export const Check = koboyo("Check");
export const CheckCircle = koboyo("CheckCircle");
export const CheckCircle2 = koboyo("CheckCircle2");
export const ChevronDown = koboyo("ChevronDown");
export const ChevronLeft = koboyo("ChevronLeft");
export const ChevronRight = koboyo("ChevronRight");
export const ChevronUp = koboyo("ChevronUp");
export const Clock = koboyo("Clock");
export const Code = koboyo("Code");
export const Code2 = koboyo("Code2");
export const Copy = koboyo("Copy");
export const CreditCard = koboyo("CreditCard");
export const Crown = koboyo("Crown");
export const DollarSign = koboyo("DollarSign");
export const Download = koboyo("Download");
export const ExternalLink = koboyo("ExternalLink");
export const Eye = koboyo("Eye");
export const EyeOff = koboyo("EyeOff");
export const FileText = koboyo("FileText");
export const Filter = koboyo("Filter");
export const Globe = koboyo("Globe");
export const Globe2 = koboyo("Globe2");
export const Heart = koboyo("Heart");
export const HelpCircle = koboyo("HelpCircle");
export const Home = koboyo("Home");
export const SquaresFour = koboyo("SquaresFour");
export const Broadcast = koboyo("Broadcast");
export const Key = koboyo("Key");
export const KeyRound = koboyo("KeyRound");
export const Layers = koboyo("Layers");
export const Link2 = koboyo("Link2");
export const Loader2 = koboyo("Loader2");
export const Lock = koboyo("Lock");
export const LockKeyhole = koboyo("LockKeyhole");
export const LogOut = koboyo("LogOut");
export const Mail = koboyo("Mail");
export const MailCheck = koboyo("MailCheck");
export const Menu = koboyo("Menu");
export const MessageSquare = koboyo("MessageSquare");
export const Pause = koboyo("Pause");
export const Pencil = koboyo("Pencil");
export const Play = koboyo("Play");
export const PlayCircle = koboyo("PlayCircle");
export const PlugZap = koboyo("Webhook");
export const Plus = koboyo("Plus");
export const Power = koboyo("Power");
export const QrCode = koboyo("QrCode");
export const ReceiptText = koboyo("ReceiptText");
export const RefreshCcw = koboyo("RefreshCcw");
export const RefreshCw = koboyo("RefreshCw");
export const RotateCw = koboyo("RotateCw");
export const Save = koboyo("Save");
export const Send = koboyo("Send");
export const Server = koboyo("Server");
export const Share2 = koboyo("Share2");
export const Shield = koboyo("Shield");
export const ShieldAlert = koboyo("ShieldAlert");
export const ShieldCheck = koboyo("ShieldCheck");
export const ShieldOff = koboyo("ShieldOff");
export const ShieldX = koboyo("ShieldX");
export const ShoppingBag = koboyo("ShoppingBag");
export const Sliders = koboyo("Sliders");
export const Sparkles = koboyo("Sparkles");
export const Terminal = koboyo("Terminal");
export const TimerReset = koboyo("TimerReset");
export const Trash2 = koboyo("Trash2");
export const Upload = koboyo("Upload");
export const User = koboyo("User");
export const UserPlus = koboyo("UserPlus");
export const Users = koboyo("Users");
export const Wallet = koboyo("Wallet");
export const WalletCards = koboyo("WalletCards");
export const Webhook = koboyo("Webhook");
export const X = koboyo("X");
export const XCircle = koboyo("XCircle");
export const Zap = koboyo("Activity");
export const Trophy = koboyo("Trophy");
export const Gift = koboyo("Gift");
export const TrendingUp = koboyo("TrendingUp");
export const TrendingDown = koboyo("TrendingDown");
export const Search = koboyo("Search");
export const Tag = koboyo("Tag");
export const Inbox = koboyo("Inbox");
export const UserX = koboyo("UserX");
export const UserCheck = koboyo("UserCheck");
export const Ban = koboyo("Ban");
export const PieChart = koboyo("PieChart");
export const Settings = koboyo("Settings");
export const ThemePicker = koboyo("ThemePicker");
export const Transactions = koboyo("Transactions");
export const NotificationBadge = koboyo("NotificationBadge");
export const SpendAnalysis = koboyo("SpendAnalysis");
export const SubscriptionRenewal = koboyo("SubscriptionRenewal");
export const CheckoutPlaybook = koboyo("CheckoutPlaybook");
export const TransactionLogs = koboyo("TransactionLogs");
