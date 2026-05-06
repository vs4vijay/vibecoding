# JsonContext

JsonContext is a JSON-based context provider for Entity Framework Core. It allows you to save and load data from JSON files.

## Installation

```sh
dotnet add package JsonContext --version 1.0.0
```

## Usage

Here is an example of how to use the JsonContext in a .NET Core application.


```csharp
public class MyDbContext : DbContext
{
    public MyDbContext(DbContextOptions<MyDbContext> options) : base(options)
    {
    }

    // Define your DbSets here
    public DbSet<MyEntity> MyEntities { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        // Configure your model here
    }
}
```

### Project Structure

```
JsonContextExample/
│
├── JsonContextExample.csproj
├── Program.cs
├── MyDbContext.cs
└── Models/
    └── MyEntity.cs
```

---

class Program
{
    static void Main()
    {
        var jsonProvider = new JsonProvider<MyDbContext>("data.json");

        using (var context = new MyDbContext())
        {
            // Load data from JSON
            jsonProvider.LoadData(context);

            // Perform database operations
            var entity = new MyEntity { Name = "Sample Entity" };
            context.MyEntities.Add(entity);
            context.SaveChanges();

            // Save changes to JSON
            jsonProvider.SaveChanges(context);
        }
    }
}