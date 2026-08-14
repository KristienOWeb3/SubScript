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
export const PlugZap = koboyo("PlugZap");
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
export const Zap = koboyo("Zap");
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
