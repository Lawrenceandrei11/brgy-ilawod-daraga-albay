import { PngSlot } from './ui'
import { useMyAvatarUrl } from '../lib/avatar'

/**
 * The signed-in user's picture wherever the portals show "who is signed in".
 * With no picture it renders exactly the placeholder that was there before,
 * with the same props, so nothing changes for anyone who has not set one.
 *
 *   <MyAvatar className="av" name="resident-placeholder.png" pill quiet />
 */
export function MyAvatar({ className = '', style, ...placeholder }) {
  const url = useMyAvatarUrl()
  if (!url) return <PngSlot className={className} style={style} {...placeholder} />
  return <img src={url} alt="" className={`${className} avatar-img`.trim()} style={style} />
}

export default MyAvatar
