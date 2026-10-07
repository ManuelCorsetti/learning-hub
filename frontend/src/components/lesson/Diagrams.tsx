// The diagram registry: the only visuals a diagram block can show. Ported from the v0.1
// `Visual` component (git show 8b9778e:src/main.jsx). Add a key to DIAGRAM_KEYS in
// shared/domain.ts and a component here to register a new one.
import type { JSX } from 'react'
import type { DiagramKey } from '../../../../shared/domain'

export const DIAGRAMS: Record<DiagramKey, () => JSX.Element> = {
  star: () => (
    <div className="star-visual">
      <div className="node fact-node">
        <b>fact_sales</b>
        <small>what happened?</small>
        <span>quantity · revenue · cost</span>
      </div>
      <div className="node n-date">
        dim_date<small>when?</small>
      </div>
      <div className="node n-customer">
        dim_customer<small>who?</small>
      </div>
      <div className="node n-product">
        dim_product<small>what?</small>
      </div>
      <div className="node n-store">
        dim_store<small>where?</small>
      </div>
    </div>
  ),
  schema: () => (
    <div className="schema-grid">
      <div className="schema-code">
        <b>fact_sales</b>
        <br />
        date_key · FK
        <br />
        customer_key · FK
        <br />
        product_key · FK
        <br />
        store_key · FK
        <hr />
        quantity
        <br />
        revenue
        <br />
        cost
      </div>
      <div className="schema-code">
        <b>dim_product</b>
        <br />
        product_key · PK
        <br />
        product_name
        <br />
        brand
        <br />
        category
        <br />
        department
      </div>
      <div className="schema-note">
        <span>FACT</span> measures the event
        <br />
        <span>DIMENSION</span> describes the event
      </div>
    </div>
  ),
  hierarchy: () => (
    <div className="hierarchy">
      <div>product</div>
      <b>→</b>
      <div>subcategory</div>
      <b>→</b>
      <div>category</div>
      <b>→</b>
      <div>department</div>
      <section>
        <small>becomes one easy-to-query dimension</small>
        <strong>dim_product</strong>
        <p>product · subcategory · category · department · brand</p>
      </section>
    </div>
  ),
  conformed: () => (
    <div className="conformed">
      <div>
        <b>fact_sales</b>
        <small>product_key</small>
      </div>
      <strong>dim_product</strong>
      <div>
        <b>fact_returns</b>
        <small>product_key</small>
      </div>
    </div>
  ),
  marketing: () => (
    <div className="marketing-grid">
      <div>
        <small>EVENT</small>
        <b>impression</b>
        <span>customer × offer × time</span>
      </div>
      <div>
        <small>CONTEXT</small>
        <b>dimensions</b>
        <span>customer · offer · channel</span>
      </div>
      <div>
        <small>OUTCOME</small>
        <b>facts</b>
        <span>click · conversion · value</span>
      </div>
    </div>
  ),
}
