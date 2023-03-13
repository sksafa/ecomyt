
import axios from "axios";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../../components/Layout/Layout";
import UserMenu from "../../components/Layout/UserMenu";
import { useAuth } from "../../context/auth";
import { useCart } from "../../context/cart";
const Dashboard = () => {
  const [auth] = useAuth();
  const [cart, setCart] = useCart();
  const [orders, setOrders] = useState([]);

  
  const getOrders = async () => {
    try {
      const { data } = await axios.get("/api/v1/auth/orders");
      setOrders(data);
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    if (auth?.token) getOrders();
  }, [auth?.token]);
  return (
    <Layout title={"Dashboard -Ecommerce App"}>
      <div className="userDashboard">
        <div className="container">
          <div className="row">
            <div className="col-md-3 p-0 m-0">
              <UserMenu />
            </div>
            <div className="col-md-9">
              <div className="row">
                <div className="col-md-4">
                  <Link to="/cart" className="text-decoration-none" >
                    <div className="card shadow bg-success p-2 text-white p-4 " style={{height:"200px"}}>
                      <h4>My Cart Product </h4>
                      <h4>( {cart.length})</h4>
                    </div>
                  </Link>
                </div>
                <div className="col-md-4">
                  <Link to="/dashboard/user/orders" className="text-decoration-none">
                    <div className="card shadow bg-danger bg-gradient text-white p-4" style={{height:"200px"}}>
                      <h4>My Order Items</h4>
                      <h4>({orders.length})</h4>
                    </div>
                  </Link>
                </div>
                <div className="col-md-4">
                  <Link to="/dashboard/user" className="text-decoration-none">
                    <div className="card shadow bg-info bg-gradient text-white p-4" style={{height:"200px"}}>
                      <h4>My Favorites Product</h4>
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

export default Dashboard;