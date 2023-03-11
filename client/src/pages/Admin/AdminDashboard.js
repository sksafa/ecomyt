
import React, { useEffect, useState } from "react";
import AdminMenu from "../../components/Layout/AdminMenu";
import Layout from "./../../components/Layout/Layout";
import { useAuth } from "../../context/auth";
import { Link } from "react-router-dom";
import axios from "axios";
import { toast } from "react-hot-toast";
const AdminDashboard = () => {
  const [auth] = useAuth();
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);


  useEffect(() => {
    if (auth?.token) {
      getOrders();
      getAllProducts();
      getAllCategory();
    }
  }, [auth?.token]);


  const getOrders = async () => {
    try {
      const { data } = await axios.get("/api/v1/auth/all-orders");
      setOrders(data);
      console.log("order data", data);
    } catch (error) {
      console.log(error);
    }
  };

  const getAllProducts = async () => {
    try {
      const { data } = await axios.get("/api/v1/product/get-product");
      setProducts(data.products);

    } catch (error) {
      console.log(error);
      toast.error("Someething Went Wrong");
    }
  };

  const getAllCategory = async () => {
    try {
      const { data } = await axios.get("/api/v1/category/get-category");
        setCategories(data.category);
    } catch (error) {
      console.log(error);
      toast.error("Something wwent wrong in getting catgeory");
    }
  };



  return (
    <Layout>
      <div className="adminDashboard">
        <div className="container ">
          <div className="row">
            <div className="col-md-3 p-0 m-0">
              <AdminMenu />
            </div>
            <div className="col-md-9">
              <div className="row">
                <div className="col-md-4">
                  <Link to="/" className="text-decoration-none" >
                    <div className="card shadow bg-success p-2 text-white p-4 " style={{ height: "150px" }}>
                      <h4>Total Categories </h4>
                      <h4>{categories.length}</h4>
                    </div>
                  </Link>
                </div>
                <div className="col-md-4">
                  <Link to="/dashboard/admin/products" className="text-decoration-none">
                    <div className="card shadow bg-danger bg-gradient text-white p-4" style={{ height: "150px" }}>
                      <h4> Total Products</h4>
                      <h4>{products.length}</h4>
                    </div>
                  </Link>
                </div>

                <div className="col-md-4">
                  <Link to="/dashboard/admin/orders" className="text-decoration-none">
                    <div className="card shadow bg-danger bg-gradient text-white p-4" style={{ height: "150px" }}>
                      <h4> Total Orders</h4>
                      <h4>{orders.length}</h4>
                    </div>
                  </Link>
                </div>

                <div className="col-md-4 mt-4">
                  <Link to="/dashboard/admin/orders" className="text-decoration-none">
                    <div className="card shadow bg-info bg-gradient text-white p-4" style={{ height: "150px" }}>
                      <h4>Today Orders</h4>
                      <h4>(0)</h4>
                    </div>
                  </Link>
                </div>

                <div className="col-md-4 mt-4">
                  <Link to="/dashboard/admin" className="text-decoration-none">
                    <div className="card shadow bg-primary text-white p-4" style={{ height: "150px" }}>
                      <h4>Ship Orders</h4>
                      <h4>(0)</h4>
                    </div>
                  </Link>
                </div>

                <div className="col-md-4 mt-4">
                  <Link to="/dashboard/admin" className="text-decoration-none">
                    <div className="card shadow bg-secondary bg-gradient text-white p-4" style={{ height: "150px" }}>
                      <h4>Delivered Orders</h4>
                      <h4>(0)</h4>
                    </div>
                  </Link>
                </div>

                <div className="col-md-4 mt-4">
                  <Link to="/dashboard/admin" className="text-decoration-none">
                    <div className="card shadow bg-dark bg-gradient text-white p-4" style={{ height: "150px" }}>
                      <h4>Cancel Orders</h4>
                      <h4>(0)</h4>
                    </div>
                  </Link>
                </div>

              </div>
            </div>
          </div>
        </div>
      </div>

    </Layout>
  );
};

export default AdminDashboard;