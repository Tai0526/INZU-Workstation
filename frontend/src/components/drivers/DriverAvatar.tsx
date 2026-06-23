import { useFileUrl } from '@/lib/storage/fileStore'

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

/** Driver avatar — shows the uploaded photo if present, otherwise initials. */
export default function DriverAvatar({
  name,
  photoFileId,
  size = 40,
}: {
  name: string
  photoFileId?: string
  size?: number
}) {
  const url = useFileUrl(photoFileId || undefined)
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-brand/15 font-display font-bold text-brand"
      style={{ width: size, height: size, fontSize: size * 0.32 }}
    >
      {initials(name)}
    </div>
  )
}
