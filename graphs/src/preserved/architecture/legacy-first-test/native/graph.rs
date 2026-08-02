use crate::types::{NativeGraphEdgeInput, NativeGraphMetrics};
use petgraph::graph::Graph;
use petgraph::unionfind::UnionFind;
use std::collections::{HashMap, HashSet};

pub fn compute_graph_metrics(edges: Vec<NativeGraphEdgeInput>) -> NativeGraphMetrics {
  let started = std::time::Instant::now();
  let mut node_ids: HashSet<String> = HashSet::new();
  let mut import_count = 0u32;

  for edge in &edges {
    node_ids.insert(edge.source.clone());
    node_ids.insert(edge.target.clone());
    if edge.kind == "import" {
      import_count += 1;
    }
  }

  let mut index: HashMap<String, usize> = HashMap::new();
  let mut nodes: Vec<String> = node_ids.into_iter().collect();
  nodes.sort();
  for (i, id) in nodes.iter().enumerate() {
    index.insert(id.clone(), i);
  }

  let mut graph: Graph<(), (), petgraph::Undirected> = Graph::new_undirected();
  let mut node_map: HashMap<usize, petgraph::graph::NodeIndex> = HashMap::new();
  for (i, _) in nodes.iter().enumerate() {
    node_map.insert(i, graph.add_node(()));
  }

  for edge in &edges {
    if edge.kind != "import" {
      continue;
    }
    if let (Some(&a), Some(&b)) = (index.get(&edge.source), index.get(&edge.target)) {
      if a != b {
        if let (Some(na), Some(nb)) = (node_map.get(&a), node_map.get(&b)) {
          graph.add_edge(*na, *nb, ());
        }
      }
    }
  }

  let n = nodes.len();
  let mut uf = UnionFind::new(n.max(1));
  for edge in graph.edge_indices() {
    let (a, b) = graph.edge_endpoints(edge).unwrap();
    uf.union(a.index(), b.index());
  }
  let mut roots = HashSet::new();
  for i in 0..n {
    roots.insert(uf.find(i));
  }

  NativeGraphMetrics {
    file_count: n as u32,
    edge_count: edges.len() as u32,
    import_edge_count: import_count,
    connected_components: roots.len().max(if n == 0 { 0 } else { 1 }) as u32,
    duration_ms: started.elapsed().as_millis().min(u128::from(u32::MAX)) as u32,
  }
}
