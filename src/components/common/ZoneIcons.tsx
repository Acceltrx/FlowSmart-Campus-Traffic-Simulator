import React from 'react';

export const ArrowInIcon: React.FC<{ size?: number; className?: string; color?: string }> = ({
  size = 14,
  className = '',
  color = '#254B98',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M11 2v12" />
    <path d="M2 8h9" />
    <path d="M7 4.5l3.5 3.5L7 11.5" />
  </svg>
);

export const ArrowOutIcon: React.FC<{ size?: number; className?: string; color?: string }> = ({
  size = 14,
  className = '',
  color = '#25A76B',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke={color}
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M5 2v12" />
    <path d="M5 8h9" />
    <path d="M10.5 4.5L14 8l-3.5 3.5" />
  </svg>
);

export const CarAndPersonIcon: React.FC<{ size?: number; className?: string; color?: string }> = ({
  size = 14,
  className = '',
  color = '#F59E0B',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 16"
    fill="none"
    stroke={color}
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {/* Car body */}
    <path d="M1 9h8.5l1.5-3.5h3.5L16 9" />
    <path d="M1 9v3.5h1.5m3 0h3.5m3 0H16V9" />
    <circle cx="4" cy="12.5" r="1.3" fill={color} stroke="none" />
    <circle cx="10.5" cy="12.5" r="1.3" fill={color} stroke="none" />
    {/* Person standing next to car */}
    <circle cx="16.5" cy="4" r="1.5" />
    <path d="M14 14.5v-3.5a1.8 1.8 0 0 1 1.8-1.8h1.4a1.8 1.8 0 0 1 1.8 1.8v3.5" />
  </svg>
);
