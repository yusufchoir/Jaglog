import React from "react";

export function DeviceTypeIcon({
  type,
  size = 20,
  color = "currentColor",
}: {
  type: string;
  size?: number;
  color?: string;
}) {
  const t = type.toLowerCase();

  if (t === "mikrotik" || t === "router") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <circle cx="6" cy="12" r="1.5" />
        <circle cx="10" cy="12" r="1.5" />
        <circle cx="14" cy="12" r="1.5" />
        <path d="M18 12h2" />
        <path d="M7 5V3" />
        <path d="M17 5V3" />
      </svg>
    );
  }

  if (t === "switch" || t === "switch_tak_terpantau") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <line x1="6" y1="10" x2="6" y2="14" />
        <line x1="10" y1="10" x2="10" y2="14" />
        <line x1="14" y1="10" x2="14" y2="14" />
        <line x1="18" y1="10" x2="18" y2="14" />
        <path d="M7 9l2-2 2 2" />
        <path d="M17 15l-2 2-2-2" />
      </svg>
    );
  }

  if (t === "firewall") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2l8 4v6c0 5.25-3.5 10-8 11-4.5-1-8-5.75-8-11V6l8-4z" />
        <path d="M12 9v4" />
        <circle cx="12" cy="16" r="0.75" fill={color} />
      </svg>
    );
  }

  if (t === "windows") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="8" height="7" rx="1" />
        <rect x="13" y="4" width="8" height="7" rx="1" />
        <rect x="3" y="13" width="8" height="7" rx="1" />
        <rect x="13" y="13" width="8" height="7" rx="1" />
      </svg>
    );
  }

  if (t === "linux") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M7 9l3 3-3 3" />
        <line x1="12" y1="15" x2="16" y2="15" />
      </svg>
    );
  }

  if (t === "internet") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <line x1="3.6" y1="9" x2="20.4" y2="9" />
        <line x1="3.6" y1="15" x2="20.4" y2="15" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
      </svg>
    );
  }

  if (t === "isp") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 11a8 8 0 0 1 16 0" />
        <path d="M7 14a5 5 0 0 1 10 0" />
        <circle cx="12" cy="18" r="1.5" />
        <line x1="12" y1="18" x2="12" y2="21" />
      </svg>
    );
  }

  if (t === "cloud") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
      </svg>
    );
  }

  // Generic other server / node
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="20" height="7" rx="1.5" />
      <rect x="2" y="14" width="20" height="7" rx="1.5" />
      <circle cx="6" cy="6.5" r="1" />
      <circle cx="6" cy="17.5" r="1" />
      <line x1="10" y1="6.5" x2="18" y2="6.5" />
      <line x1="10" y1="17.5" x2="18" y2="17.5" />
    </svg>
  );
}
