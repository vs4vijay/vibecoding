using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;

namespace JsonContext
{
    public class JsonContext<TContext> where TContext : DbContext, new()
    {
        private readonly string _filePath;

        public JsonContext(string filePath)
        {
            _filePath = filePath;
        }

        public void SaveChanges(TContext context)
        {
            var data = new Dictionary<string, object>();

            foreach (var entry in context.ChangeTracker.Entries())
            {
                var entityType = entry.Entity.GetType().Name;
                if (!data.ContainsKey(entityType))
                {
                    data[entityType] = new List<object>();
                }

                ((List<object>)data[entityType]).Add(entry.Entity);
            }

            var json = JsonConvert.SerializeObject(data, Formatting.Indented);
            File.WriteAllText(_filePath, json);
        }

        public void LoadData(TContext context)
        {
            if (!File.Exists(_filePath))
            {
                return;
            }

            var json = File.ReadAllText(_filePath);
            var data = JsonConvert.DeserializeObject<Dictionary<string, List<object>>>(json);

            if (data == null)
            {
                return;
            }

            foreach (var kvp in data)
            {
                var entityType = Type.GetType(kvp.Key);
                if (entityType == null)
                {
                    continue;
                }

                var dbSet = context.GetType().GetMethod("Set", Type.EmptyTypes)?.MakeGenericMethod(entityType).Invoke(context, null);
                if (dbSet == null)
                {
                    continue;
                }

                var method = dbSet.GetType().GetMethod("AddRange");
                if (method == null)
                {
                    continue;
                }

                method.Invoke(dbSet, new[] { kvp.Value });
            }
        }
    }
}