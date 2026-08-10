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

export function CardHeader({ title, children }) {
  return (
    <div className="card-hd">
      <h3>{title}</h3>
      {children}
    </div>
  )
}

export default Card
