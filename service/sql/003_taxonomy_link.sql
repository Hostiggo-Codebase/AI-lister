-- Fill external_taxonomy_map.internal_id by matching internal_slug against your
-- catalog tables. Adjust column names to your real schema if they differ from
-- app/schema_map.py.

set search_path to hostiggo_testing_schema, public;

update external_taxonomy_map m
set internal_id = p.type_id
from property_types p
where m.entity_type = 'property_type'
  and m.internal_id is null
  and lower(replace(p.name, ' ', '_')) = m.internal_slug;

update external_taxonomy_map m
set internal_id = s.type_id
from stay_types s
where m.entity_type = 'stay_type'
  and m.internal_id is null
  and lower(replace(s.name, ' ', '_')) = m.internal_slug;

update external_taxonomy_map m
set internal_id = a.amenity_id
from amenities a
where m.entity_type = 'amenity'
  and m.internal_id is null
  and lower(replace(a.name, ' ', '_')) = m.internal_slug;

-- report anything still unlinked
select entity_type, internal_slug, count(*)
from external_taxonomy_map
where internal_id is null
group by 1, 2
order by 1, 2;
