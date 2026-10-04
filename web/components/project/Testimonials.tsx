import styles from "./project.module.css";

type Testimonial = {
  quote: string;
  name: string;
  title: string;
};

// Add approved quotes, names and professional titles here when ready to publish.
// An empty list keeps the whole section out of the rendered page.
const testimonials: Testimonial[] = [];

export function Testimonials() {
  if (testimonials.length === 0) return null;

  return (
    <section className={styles.section} aria-label="What people say">
      <div className={styles.sectionHead}>
        <h2>What people say</h2>
      </div>
      <div className={styles.cardGrid}>
        {testimonials.map(({ quote, name, title }) => (
          <figure className={styles.card} key={`${name}-${quote}`}>
            <blockquote>
              <p>{quote}</p>
            </blockquote>
            <figcaption className="mt-5 text-sm">
              <span className="block font-semibold">{name}</span>
              <span className="text-[var(--color-muted)]">{title}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
