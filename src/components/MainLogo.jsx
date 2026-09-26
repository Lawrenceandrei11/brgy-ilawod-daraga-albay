import { PngSlot } from './ui'
import { useMainLogo } from '../lib/branding'

/**
 * The barangay seal wherever the system shows its own mark.
 *
 * A drop-in for the <PngSlot name="barangay-logo.png"> calls that were here
 * before, taking the same props, so every header keeps the size, shape and
 * styling it already had. The only difference is the picture: PngSlot tries
 * `src` first and falls back to /assets/barangay-logo.png, so an uploaded
 * logo is used when there is one, and the artwork that ships with the app is
 * used when there is not -- or when the uploaded file has gone missing.
 */
export function MainLogo(props) {
  const { url } = useMainLogo()
  return <PngSlot name="barangay-logo.png" src={url} {...props} />
}

export default MainLogo
