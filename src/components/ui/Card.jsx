/**
 * Card and its header. `flush` removes padding so tables and feeds can sit
 * edge to edge inside the rounded corners.
 */
export function Card({ padded = false, flush = false, children, className = '', ...rest }) {
  const classes = ['card', padded ? 'card-p' : '', className].filter(Boolean).join(' ')
  const style = flush ? { padding: 0, overflow: 'hidden', ...rest.style } : rest.style
  return (
    <div {...rest} className={classes} style={style}>
      {children}
    </div>
  )
}

/**
 * A card title is the second level of the page, under its <h1> — so it is an
 * <h2>, not an <h3>. Screen-reader users navigate by heading level, and
 * jumping h1 → h3 reads as a missing section.
 */
export function CardHeader({ title, children }) {
  return (
    <div className="card-hd">
      <h2>{title}</h2>
      {children}
    </div>
  )
}

export default Card
