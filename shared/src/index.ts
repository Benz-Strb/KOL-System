export const PLACEMENT_TYPES = ['online', 'offline_shop'] as const;
export type PlacementType = (typeof PLACEMENT_TYPES)[number];

export const PAYMENT_TYPES = ['paid', 'free', 'barter'] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PLACEMENT_STATUSES = ['planned', 'posted', 'cancelled'] as const;
export type PlacementStatus = (typeof PLACEMENT_STATUSES)[number];

export const CHANNELS = ['shopee', 'lazada', 'website', 'tiktok'] as const;
export type Channel = (typeof CHANNELS)[number];

export const USER_ROLES = ['manager', 'marketing', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];
