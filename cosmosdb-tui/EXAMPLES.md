# Example Cosmos DB Queries

This file contains example SQL queries for common Cosmos DB operations.

## Basic Queries

### Select All Documents
```sql
SELECT * FROM c
```

### Select First N Documents
```sql
SELECT TOP 10 * FROM c
SELECT TOP 100 * FROM c
```

### Select Specific Fields
```sql
SELECT c.id, c.name, c.email FROM c
SELECT c.id, c.properties.address FROM c
```

### Count Documents
```sql
SELECT VALUE COUNT(1) FROM c
```

## Filtering

### Simple WHERE Clause
```sql
SELECT * FROM c WHERE c.status = 'active'
SELECT * FROM c WHERE c.age > 18
SELECT * FROM c WHERE c.price < 100
```

### Multiple Conditions (AND)
```sql
SELECT * FROM c WHERE c.status = 'active' AND c.age > 18
SELECT * FROM c WHERE c.category = 'electronics' AND c.price > 100 AND c.inStock = true
```

### Multiple Conditions (OR)
```sql
SELECT * FROM c WHERE c.status = 'active' OR c.status = 'pending'
SELECT * FROM c WHERE c.category = 'books' OR c.category = 'magazines'
```

### IN Operator
```sql
SELECT * FROM c WHERE c.status IN ('active', 'pending', 'processing')
SELECT * FROM c WHERE c.category IN ('electronics', 'computers', 'phones')
```

### NOT IN Operator
```sql
SELECT * FROM c WHERE c.status NOT IN ('deleted', 'archived')
```

### Pattern Matching
```sql
SELECT * FROM c WHERE STARTSWITH(c.name, 'John')
SELECT * FROM c WHERE ENDSWITH(c.email, '@example.com')
SELECT * FROM c WHERE CONTAINS(c.description, 'premium')
```

### NULL Checks
```sql
SELECT * FROM c WHERE IS_DEFINED(c.email)
SELECT * FROM c WHERE NOT IS_DEFINED(c.email)
SELECT * FROM c WHERE IS_NULL(c.deletedAt)
SELECT * FROM c WHERE NOT IS_NULL(c.deletedAt)
```

## Sorting

### Order by Single Field
```sql
SELECT * FROM c ORDER BY c.createdAt DESC
SELECT * FROM c ORDER BY c.name ASC
SELECT * FROM c ORDER BY c._ts DESC
```

### Order by Multiple Fields
```sql
SELECT * FROM c ORDER BY c.category ASC, c.price DESC
SELECT * FROM c ORDER BY c.status ASC, c.createdAt DESC
```

## Aggregations

### Count by Group
```sql
SELECT c.category, COUNT(1) as count 
FROM c 
GROUP BY c.category
```

### Sum and Average
```sql
SELECT c.category, SUM(c.price) as total, AVG(c.price) as average
FROM c
GROUP BY c.category
```

### Min and Max
```sql
SELECT c.category, MIN(c.price) as minPrice, MAX(c.price) as maxPrice
FROM c
GROUP BY c.category
```

## Array Operations

### Query Documents with Arrays
```sql
SELECT * FROM c WHERE ARRAY_LENGTH(c.tags) > 0
```

### Join Arrays (Flatten)
```sql
SELECT c.id, tag
FROM c
JOIN tag IN c.tags
```

### Filter on Array Elements
```sql
SELECT * FROM c WHERE ARRAY_CONTAINS(c.tags, 'featured')
```

### Array with Objects
```sql
SELECT c.id, item
FROM c
JOIN item IN c.items
WHERE item.quantity > 0
```

## Date and Time Queries

### Filter by Timestamp
```sql
SELECT * FROM c WHERE c._ts > 1609459200
SELECT * FROM c WHERE c._ts BETWEEN 1609459200 AND 1640995199
```

### Recent Documents (last 7 days - using _ts)
```sql
SELECT * FROM c WHERE c._ts > 1640000000 ORDER BY c._ts DESC
```

### Using DateTimeFromParts
```sql
SELECT * FROM c WHERE c.createdDate >= DateTimeFromParts(2024, 1, 1)
```

## String Functions

### Concatenation
```sql
SELECT c.id, CONCAT(c.firstName, ' ', c.lastName) as fullName FROM c
```

### String Manipulation
```sql
SELECT c.id, UPPER(c.name) as upperName FROM c
SELECT c.id, LOWER(c.email) as lowerEmail FROM c
SELECT c.id, SUBSTRING(c.description, 0, 50) as preview FROM c
SELECT c.id, LENGTH(c.name) as nameLength FROM c
```

## Mathematical Functions

### Basic Math
```sql
SELECT c.id, c.price, c.quantity, (c.price * c.quantity) as total FROM c
SELECT c.id, ROUND(c.price) as roundedPrice FROM c
SELECT c.id, FLOOR(c.price) as floorPrice FROM c
SELECT c.id, CEILING(c.price) as ceilingPrice FROM c
```

### Percentages
```sql
SELECT c.id, c.price, (c.price * 0.2) as tax, (c.price * 1.2) as totalWithTax FROM c
```

## Advanced Queries

### Subqueries
```sql
SELECT c.id, c.name, 
  (SELECT VALUE COUNT(1) FROM item IN c.items) as itemCount
FROM c
```

### Conditional Logic (Ternary)
```sql
SELECT c.id, c.price,
  (c.price > 100 ? 'expensive' : 'affordable') as priceCategory
FROM c
```

### DISTINCT Values
```sql
SELECT DISTINCT c.category FROM c
SELECT DISTINCT VALUE c.status FROM c
```

### Pagination
```sql
SELECT * FROM c ORDER BY c.id OFFSET 0 LIMIT 10
SELECT * FROM c ORDER BY c.id OFFSET 10 LIMIT 10
SELECT * FROM c ORDER BY c.id OFFSET 20 LIMIT 10
```

### Cross-partition Queries
```sql
SELECT * FROM c WHERE c.userId = 'user123'
SELECT * FROM c WHERE c.email = 'user@example.com'
```

## JSON Functions

### Check Object Properties
```sql
SELECT * FROM c WHERE IS_OBJECT(c.metadata)
SELECT * FROM c WHERE IS_ARRAY(c.tags)
SELECT * FROM c WHERE IS_STRING(c.name)
SELECT * FROM c WHERE IS_NUMBER(c.age)
SELECT * FROM c WHERE IS_BOOL(c.isActive)
```

## Performance Tips

### Use Partition Key in WHERE Clause
```sql
-- Good: Uses partition key
SELECT * FROM c WHERE c.userId = 'user123' AND c.status = 'active'

-- Less efficient: No partition key
SELECT * FROM c WHERE c.status = 'active'
```

### Limit Result Set
```sql
-- Always use TOP for large result sets
SELECT TOP 100 * FROM c WHERE c.category = 'electronics'
```

### Project Only Needed Fields
```sql
-- Good: Only select needed fields
SELECT c.id, c.name, c.price FROM c

-- Less efficient: Select all fields
SELECT * FROM c
```

### Use Indexes
```sql
-- Ensure fields in WHERE and ORDER BY are indexed
SELECT * FROM c WHERE c.category = 'books' ORDER BY c.publishedDate DESC
```

## Complex Real-World Examples

### E-commerce Product Search
```sql
SELECT c.id, c.name, c.price, c.rating, c.imageUrl
FROM c
WHERE c.category = 'electronics'
  AND c.price BETWEEN 100 AND 500
  AND c.inStock = true
  AND c.rating >= 4.0
ORDER BY c.rating DESC, c.price ASC
```

### User Activity Report
```sql
SELECT c.userId, c.userName,
  COUNT(1) as totalActions,
  MIN(c._ts) as firstAction,
  MAX(c._ts) as lastAction
FROM c
WHERE c.actionType IN ('login', 'purchase', 'review')
  AND c._ts > 1640000000
GROUP BY c.userId, c.userName
ORDER BY totalActions DESC
```

### Inventory Status
```sql
SELECT c.category,
  COUNT(1) as totalProducts,
  SUM(c.quantity) as totalQuantity,
  AVG(c.price) as avgPrice,
  SUM(CASE WHEN c.quantity = 0 THEN 1 ELSE 0 END) as outOfStock
FROM c
WHERE IS_DEFINED(c.category)
GROUP BY c.category
ORDER BY totalProducts DESC
```

### Recent Orders with Details
```sql
SELECT c.id, c.userId, c.orderDate,
  (SELECT VALUE SUM(item.price * item.quantity) 
   FROM item IN c.items) as orderTotal,
  ARRAY_LENGTH(c.items) as itemCount,
  c.status
FROM c
WHERE c.orderDate >= DateTimeFromParts(2024, 1, 1)
ORDER BY c.orderDate DESC
```

---

## Tips for Writing Efficient Queries

1. **Always use TOP N** when you don't need all results
2. **Include partition key** in WHERE clause when possible
3. **Index frequently queried fields** in Azure Portal
4. **Avoid SELECT *** - only select needed fields
5. **Use OFFSET/LIMIT** for pagination instead of loading all data
6. **Test queries** with small datasets first
7. **Monitor RU consumption** in Azure Portal

For more information, see:
- [Cosmos DB SQL Query Reference](https://docs.microsoft.com/azure/cosmos-db/sql-query-getting-started)
- [Query Performance Tips](https://docs.microsoft.com/azure/cosmos-db/sql-query-metrics)
