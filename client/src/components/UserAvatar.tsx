import Avatar from 'boring-avatars';

const AVATAR_PALETTE = ['#6366f1', '#06b6d4', '#f59e0b', '#ec4899', '#10b981'];

export default function UserAvatar({ name, size = 28 }: { name: string; size?: number }) {
  return <Avatar name={name} variant="beam" size={size} colors={AVATAR_PALETTE} className="shrink-0" />;
}
